import { CString, dlopen, read as readMemory } from "bun:ffi";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

import { MarketplaceError } from "./error";
import type { MarketplaceErrorCode } from "./error";

const nativeSymbols = {
  openat: { args: ["i32", "ptr", "i32", "u32"], returns: "i32" },
  fdopendir: { args: ["i32"], returns: "ptr" },
  readdir: { args: ["ptr"], returns: "ptr" },
  closedir: { args: ["ptr"], returns: "i32" },
} as const;

const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const fileFlags = constants.O_RDONLY | constants.O_NOFOLLOW;

export type ConfinementOptions = Readonly<{
  readonly afterDirectoryOpen?: (relativeDirectory: string) => void;
  readonly afterInitialStat?: (absolutePath: string) => void;
  readonly afterRootPathResolved?: (absoluteRoot: string) => void;
  readonly forceUnsupportedPlatform?: boolean;
}>;

export type ConfinedFile = Readonly<{
  readonly relativePath: string;
  readonly bytes: Uint8Array;
}>;

type BatchRequest = Readonly<{
  readonly root: string;
  readonly rootDevice: number;
  readonly rootInode: number;
  readonly maxBytes: number;
  readonly options: ConfinementOptions;
}>;

type ExplicitRequest = BatchRequest & Readonly<{
  readonly relativePaths: readonly string[];
  readonly errorCode: MarketplaceErrorCode;
}>;

type ReaderState = Readonly<{
  readonly library: NativeLibrary;
  readonly root: string;
  readonly rootDescriptor: number;
  readonly options: ConfinementOptions;
}>;

type FileRequest = Readonly<{
  readonly parent: number;
  readonly name: string;
  readonly relativePath: string;
  readonly remaining: number;
  readonly errorCode: MarketplaceErrorCode;
}>;

type OpenRequest = Readonly<{
  readonly directory: number;
  readonly name: string;
  readonly flags: number;
}>;

function loadNative(options: ConfinementOptions) {
  if (options.forceUnsupportedPlatform === true) throw new MarketplaceError("unsupported_platform");
  const path = process.platform === "darwin"
    ? "/usr/lib/libSystem.B.dylib"
    : process.platform === "linux" ? "libc.so.6" : undefined;
  if (path === undefined) throw new MarketplaceError("unsupported_platform");
  try {
    return dlopen(path, nativeSymbols);
  } catch (error) {
    if (error instanceof Error) throw new MarketplaceError("unsupported_platform");
    throw new MarketplaceError("unsupported_platform");
  }
}

type NativeLibrary = ReturnType<typeof loadNative>;

function encodedName(name: string): Uint8Array {
  if (name.length === 0 || name === ".." || name.includes("/") || name.includes("\0")) {
    throw new MarketplaceError("unsafe_trace_path");
  }
  return new TextEncoder().encode(`${name}\0`);
}

function openAt(library: NativeLibrary, request: OpenRequest): number {
  return library.symbols.openat(request.directory, encodedName(request.name), request.flags, 0);
}

function openAbsoluteDirectory(library: NativeLibrary, root: string): number {
  if (!root.startsWith("/")) throw new MarketplaceError("invalid_root");
  let descriptor = openSync("/", directoryFlags);
  try {
    for (const name of root.split("/").filter((part) => part.length > 0)) {
      const child = openAt(library, { directory: descriptor, name, flags: directoryFlags });
      if (child < 0) throw new MarketplaceError("invalid_root");
      const parent = descriptor;
      descriptor = child;
      closeSync(parent);
    }
    return descriptor;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function directoryNames(library: NativeLibrary, descriptor: number): readonly string[] {
  const duplicate = openAt(library, { directory: descriptor, name: ".", flags: directoryFlags });
  if (duplicate < 0) throw new MarketplaceError("invalid_trace");
  const stream = library.symbols.fdopendir(duplicate);
  if (stream === null) {
    closeSync(duplicate);
    throw new MarketplaceError("invalid_trace");
  }
  const names: string[] = [];
  try {
    for (;;) {
      const entry = library.symbols.readdir(stream);
      if (entry === null) break;
      const name = process.platform === "darwin"
        ? String(new CString(entry, 21, readMemory.u16(entry, 18)))
        : String(new CString(entry, 19));
      if (name !== "." && name !== "..") names.push(name);
    }
    return names.sort();
  } finally {
    library.symbols.closedir(stream);
  }
}

function sameFile(left: Readonly<{ dev: number; ino: number; size: number }>,
  right: Readonly<{ dev: number; ino: number; size: number }>): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size;
}

function readOpenedFile(descriptor: number, remaining: number,
  errorCode: MarketplaceErrorCode): Uint8Array {
  const before = fstatSync(descriptor);
  if (!before.isFile()) throw new MarketplaceError(errorCode);
  if (before.size > remaining) {
    throw new MarketplaceError(errorCode === "trace_drift" ? errorCode : "snapshot_too_large");
  }
  const buffer = Buffer.allocUnsafe(before.size + 1);
  let offset = 0;
  while (offset < buffer.byteLength) {
    const count = readSync(descriptor, buffer, offset, buffer.byteLength - offset, offset);
    if (count === 0) break;
    offset += count;
  }
  if (offset !== before.size || !sameFile(before, fstatSync(descriptor))) {
    throw new MarketplaceError(errorCode);
  }
  return new Uint8Array(buffer.subarray(0, before.size));
}

class OpenAtReader {
  constructor(private readonly state: ReaderState) {}

  private readFile(request: FileRequest): Uint8Array {
    const descriptor = openAt(this.state.library, {
      directory: request.parent, name: request.name, flags: fileFlags,
    });
    if (descriptor < 0) throw new MarketplaceError(request.errorCode);
    try {
      const before = fstatSync(descriptor);
      this.state.options.afterInitialStat?.(`${this.state.root}/${request.relativePath}`);
      const bytes = readOpenedFile(descriptor, request.remaining, request.errorCode);
      const current = openAt(this.state.library, {
        directory: request.parent, name: request.name, flags: fileFlags,
      });
      if (current < 0) throw new MarketplaceError(request.errorCode);
      try {
        if (!sameFile(before, fstatSync(current))) throw new MarketplaceError(request.errorCode);
      } finally {
        closeSync(current);
      }
      return bytes;
    } finally {
      closeSync(descriptor);
    }
  }

  discover(maxBytes: number): readonly ConfinedFile[] {
    const files: ConfinedFile[] = [];
    let retained = 0;
    const walk = (directory: number, prefix: string): void => {
      for (const name of directoryNames(this.state.library, directory)) {
        const relativePath = prefix === "" ? name : `${prefix}/${name}`;
        const child = openAt(this.state.library, { directory, name, flags: directoryFlags });
        if (child >= 0) {
          try {
            this.state.options.afterDirectoryOpen?.(relativePath);
            walk(child, relativePath);
          } finally {
            closeSync(child);
          }
        } else if (name.endsWith(".atf.json")) {
          const file = openAt(this.state.library, { directory, name, flags: fileFlags });
          if (file < 0) continue;
          closeSync(file);
          const bytes = this.readFile({
            parent: directory, name, relativePath, remaining: maxBytes - retained,
            errorCode: this.state.options.afterInitialStat === undefined ? "invalid_trace" : "trace_drift",
          });
          files.push({ relativePath, bytes });
          retained += bytes.byteLength;
        }
      }
    };
    walk(this.state.rootDescriptor, "");
    return files;
  }

  explicit(request: ExplicitRequest): readonly ConfinedFile[] {
    const files: ConfinedFile[] = [];
    let retained = 0;
    for (const relativePath of request.relativePaths) {
      const parts = relativePath.split("/");
      const name = parts.pop();
      if (name === undefined) throw new MarketplaceError("unsafe_trace_path");
      const opened: number[] = [];
      let parent = this.state.rootDescriptor;
      try {
        let prefix = "";
        for (const part of parts) {
          const child = openAt(this.state.library, {
            directory: parent, name: part, flags: directoryFlags,
          });
          if (child < 0) throw new MarketplaceError(request.errorCode);
          opened.push(child);
          parent = child;
          prefix = prefix === "" ? part : `${prefix}/${part}`;
          this.state.options.afterDirectoryOpen?.(prefix);
        }
        const bytes = this.readFile({
          parent, name, relativePath, remaining: request.maxBytes - retained,
          errorCode: request.errorCode,
        });
        files.push({ relativePath, bytes });
        retained += bytes.byteLength;
      } finally {
        for (const descriptor of opened.toReversed()) closeSync(descriptor);
      }
    }
    return files;
  }
}

function withReader<T>(request: BatchRequest, action: (reader: OpenAtReader) => T): T {
  const library = loadNative(request.options);
  let descriptor: number | undefined;
  try {
    const root = request.root;
    descriptor = openAbsoluteDirectory(library, root);
    const rootStatus = fstatSync(descriptor);
    if (!rootStatus.isDirectory() || rootStatus.dev !== request.rootDevice || rootStatus.ino !== request.rootInode) throw new MarketplaceError("invalid_root");
    request.options.afterRootPathResolved?.(root);
    return action(new OpenAtReader({ library, root, rootDescriptor: descriptor, options: request.options }));
  } catch (error) {
    if (error instanceof MarketplaceError) throw error;
    throw new MarketplaceError("invalid_root");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    library.close();
  }
}

export function discoverConfinedFiles(request: BatchRequest): readonly ConfinedFile[] {
  return withReader(request, (reader) => reader.discover(request.maxBytes));
}

export function readConfinedFiles(request: ExplicitRequest): readonly ConfinedFile[] {
  return withReader(request, (reader) => reader.explicit(request));
}
