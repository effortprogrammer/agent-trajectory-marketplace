import { createHash } from "node:crypto"
import { existsSync, lstatSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { ZodType } from "zod"

import { resolveReadableProjectPath, resolveWritableProjectPath } from "./path-safety"
import {
  type ManifestFile,
  SellerPackageError,
  SellerPackageErrorCode,
} from "./seller-package-contract"

export const throwSellerPathError = (code: SellerPackageErrorCode, path: string): never => {
  throw new SellerPackageError(code, `${code}: ${path}`)
}

export const sha256File = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex")

export const writeJsonFile = (path: string, value: unknown) => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

const isErrorWithCode = (error: unknown, code: string) =>
  error instanceof Error && "code" in error && error.code === code

const readLinkStatus = (path: string) => {
  try {
    return lstatSync(path)
  } catch (error) {
    if (isErrorWithCode(error, "ENOENT")) {
      return undefined
    }
    throw error
  }
}

export const readJsonFile = <T>(
  path: string,
  schema: ZodType<T>,
  code: SellerPackageErrorCode,
): T => {
  let rawJson: unknown
  try {
    rawJson = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    if (error instanceof Error) {
      throw new SellerPackageError(code, `${code}: ${path}`)
    }
    throw error
  }

  const parsed = schema.safeParse(rawJson)
  if (!parsed.success) {
    throw new SellerPackageError(code, `${code}: ${path}`)
  }
  return parsed.data
}

export const assertUsableDirectory = (path: string, code: SellerPackageErrorCode) => {
  if (!existsSync(path)) {
    return
  }
  if (!statSync(path).isDirectory()) {
    throw new SellerPackageError(code, `${code}: ${path}`)
  }
}

export const assertClosedPackageDirectory = (
  packageDir: string,
  allowedFileNames: readonly string[],
) => {
  if (!existsSync(packageDir)) {
    return
  }
  const allowedNames = new Set(allowedFileNames)
  for (const entryName of readdirSync(packageDir)) {
    if (!allowedNames.has(entryName)) {
      throw new SellerPackageError(
        SellerPackageErrorCode.InvalidPackageContents,
        `invalid_package_contents: ${entryName}`,
      )
    }
  }
}

const isWithinDirectory = (candidatePath: string, directoryPath: string) =>
  candidatePath === directoryPath || candidatePath.startsWith(`${directoryPath}/`)

const packageFilePath = (packageDir: string, filePath: string) =>
  resolveReadableProjectPath({
    inputPath: join(packageDir, filePath),
    code: SellerPackageErrorCode.InvalidPackagePath,
    throwPathError: throwSellerPathError,
  })

export const writablePackageFilePath = (packageDir: string, filePath: string) => {
  const absolutePath = resolveWritableProjectPath({
    inputPath: join(packageDir, filePath),
    code: SellerPackageErrorCode.InvalidOutputPath,
    throwPathError: throwSellerPathError,
  })
  if (!isWithinDirectory(absolutePath, packageDir)) {
    throw new SellerPackageError(
      SellerPackageErrorCode.InvalidOutputPath,
      `invalid_output_path: ${absolutePath}`,
    )
  }
  const linkStatus = readLinkStatus(absolutePath)
  if (linkStatus?.isSymbolicLink()) {
    throw new SellerPackageError(
      SellerPackageErrorCode.InvalidOutputPath,
      `invalid_output_path: ${absolutePath}`,
    )
  }
  return absolutePath
}

export const requirePackageFile = (packageDir: string, filePath: string) => {
  const absolutePath = packageFilePath(packageDir, filePath)
  const linkStatus = readLinkStatus(absolutePath)
  if (linkStatus === undefined) {
    throw new SellerPackageError(
      SellerPackageErrorCode.MissingPackageFile,
      `missing_package_file: ${filePath}`,
    )
  }
  if (linkStatus.isSymbolicLink() || !linkStatus.isFile()) {
    throw new SellerPackageError(
      SellerPackageErrorCode.InvalidPackageFile,
      `invalid_package_file: ${filePath}`,
    )
  }
  return absolutePath
}

export const fileEntry = (packageDir: string, filePath: string) => ({
  path: filePath,
  sha256: sha256File(requirePackageFile(packageDir, filePath)),
})

export const fileHashFromManifest = (manifest: ManifestFile, filePath: string) =>
  manifest.files.find((file) => file.path === filePath)?.sha256

export const assertManifestFileList = (
  manifest: ManifestFile,
  expectedFilePaths: readonly string[],
) => {
  const actualFilePaths = manifest.files.map((file) => file.path).sort()
  const expectedSortedFilePaths = [...expectedFilePaths].sort()
  if (
    actualFilePaths.length !== expectedSortedFilePaths.length ||
    actualFilePaths.some((filePath, index) => filePath !== expectedSortedFilePaths[index])
  ) {
    throw new SellerPackageError(
      SellerPackageErrorCode.InvalidManifestJson,
      "invalid_manifest_json: files",
    )
  }
}

export const assertManifestHash = (
  packageDir: string,
  manifest: ManifestFile,
  filePath: string,
) => {
  const expectedHash = fileHashFromManifest(manifest, filePath)
  if (expectedHash === undefined) {
    throw new SellerPackageError(
      SellerPackageErrorCode.MissingPackageFile,
      `missing_package_file: ${filePath}`,
    )
  }

  const actualHash = sha256File(requirePackageFile(packageDir, filePath))
  if (actualHash !== expectedHash) {
    throw new SellerPackageError(
      SellerPackageErrorCode.PackageHashMismatch,
      `package_hash_mismatch: ${filePath}`,
    )
  }
}
