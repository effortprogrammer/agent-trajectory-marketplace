type SignupRequest = Readonly<{
  readonly acceptTerms: true;
  readonly command: "auth-signup";
  readonly email: string;
  readonly server: string;
}>;

type LoginRequest = Readonly<{
  readonly command: "auth-login";
  readonly email: string;
  readonly server: string;
}>;

type VerifyRequest = Readonly<{
  readonly challenge: string;
  readonly codeSource: "stdin" | "tty";
  readonly command: "auth-verify";
  readonly server: string;
}>;

type StatusRequest = Readonly<{ readonly command: "auth-status"; readonly server: string }>;
type LogoutRequest = Readonly<{ readonly command: "auth-logout"; readonly server: string }>;
type InvalidAuthCommand = Readonly<{ readonly command: "invalid_auth_command" }>;
type AuthCodeRequired = Readonly<{ readonly command: "auth_code_required" }>;

export type AuthCommand =
  | SignupRequest
  | LoginRequest
  | VerifyRequest
  | StatusRequest
  | LogoutRequest
  | InvalidAuthCommand
  | AuthCodeRequired;

type AuthOptions = Readonly<{
  readonly acceptTerms: boolean;
  readonly codeStdin: boolean;
  readonly challenge?: string;
  readonly email?: string;
  readonly server?: string;
}>;

const invalidAuthCommand = (): InvalidAuthCommand => ({ command: "invalid_auth_command" });
const authCodeRequired = (): AuthCodeRequired => ({ command: "auth_code_required" });

const readOptions = (
  argumentsList: readonly string[],
  valueOptions: readonly string[],
  acceptsTerms: boolean,
  acceptsCodeStdin: boolean,
): AuthOptions | undefined => {
  let acceptTerms = false;
  let codeStdin = false;
  let challenge: string | undefined;
  let email: string | undefined;
  let server: string | undefined;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const option = argumentsList[index];
    if (option === "--accept-terms" && acceptsTerms) {
      if (acceptTerms) return undefined;
      acceptTerms = true;
      continue;
    }
    if (option === "--code-stdin" && acceptsCodeStdin) {
      if (codeStdin) return undefined;
      codeStdin = true;
      continue;
    }
    if (option === undefined || !valueOptions.includes(option)) return undefined;
    const value = argumentsList[index + 1];
    if (value === undefined || value.length === 0 || value.startsWith("--")) return undefined;
    if (option === "--server") {
      if (server !== undefined) return undefined;
      server = value;
    } else if (option === "--email") {
      if (email !== undefined) return undefined;
      email = value;
    } else if (option === "--challenge") {
      if (challenge !== undefined) return undefined;
      challenge = value;
    } else {
      return undefined;
    }
    index += 1;
  }

  return { acceptTerms, codeStdin, ...(challenge === undefined ? {} : { challenge }), ...(email === undefined ? {} : { email }), ...(server === undefined ? {} : { server }) };
};

export const parseAuthCommand = (
  argumentsList: readonly string[],
  terminalInputAvailable = true,
): AuthCommand => {
  const argumentsWithoutExecutable =
    argumentsList[0] === "trajectory" ? argumentsList.slice(1) : argumentsList;
  if (argumentsWithoutExecutable[0] !== "auth") return invalidAuthCommand();

  const action = argumentsWithoutExecutable[1];
  const options = argumentsWithoutExecutable.slice(2);
  if (action === "signup") {
    const parsed = readOptions(options, ["--server", "--email"], true, false);
    if (parsed?.server === undefined || parsed.email === undefined || !parsed.acceptTerms) {
      return invalidAuthCommand();
    }
    return { acceptTerms: true, command: "auth-signup", email: parsed.email, server: parsed.server };
  }
  if (action === "login") {
    const parsed = readOptions(options, ["--server", "--email"], false, false);
    if (parsed?.server === undefined || parsed.email === undefined) return invalidAuthCommand();
    return { command: "auth-login", email: parsed.email, server: parsed.server };
  }
  if (action === "verify") {
    const parsed = readOptions(options, ["--server", "--challenge"], false, true);
    if (parsed?.server === undefined || parsed.challenge === undefined) return invalidAuthCommand();
    if (!parsed.codeStdin && !terminalInputAvailable) return authCodeRequired();
    return {
      challenge: parsed.challenge,
      codeSource: parsed.codeStdin ? "stdin" : "tty",
      command: "auth-verify",
      server: parsed.server,
    };
  }
  if (action === "status" || action === "logout") {
    const parsed = readOptions(options, ["--server"], false, false);
    if (parsed?.server === undefined) return invalidAuthCommand();
    return action === "status"
      ? { command: "auth-status", server: parsed.server }
      : { command: "auth-logout", server: parsed.server };
  }
  return invalidAuthCommand();
};
