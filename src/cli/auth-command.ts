type SignupRequest = Readonly<{
  readonly acceptTerms: true;
  readonly command: "auth-signup";
  readonly email: string;
}>;

type LoginRequest = Readonly<{
  readonly command: "auth-login";
  readonly email: string;
}>;

type VerifyRequest = Readonly<{
  readonly challenge: string;
  readonly codeSource: "stdin" | "tty";
  readonly command: "auth-verify";
}>;

type StatusRequest = Readonly<{ readonly command: "auth-status" }>;
type LogoutRequest = Readonly<{ readonly command: "auth-logout" }>;
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
    if (option === "--email") {
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

  return { acceptTerms, codeStdin, ...(challenge === undefined ? {} : { challenge }), ...(email === undefined ? {} : { email }) };
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
    const parsed = readOptions(options, ["--email"], true, false);
    if (parsed?.email === undefined || !parsed.acceptTerms) {
      return invalidAuthCommand();
    }
    return { acceptTerms: true, command: "auth-signup", email: parsed.email };
  }
  if (action === "login") {
    const parsed = readOptions(options, ["--email"], false, false);
    if (parsed?.email === undefined) return invalidAuthCommand();
    return { command: "auth-login", email: parsed.email };
  }
  if (action === "verify") {
    const parsed = readOptions(options, ["--challenge"], false, true);
    if (parsed?.challenge === undefined) return invalidAuthCommand();
    if (!parsed.codeStdin && !terminalInputAvailable) return authCodeRequired();
    return {
      challenge: parsed.challenge,
      codeSource: parsed.codeStdin ? "stdin" : "tty",
      command: "auth-verify",
    };
  }
  if (action === "status" || action === "logout") {
    const parsed = readOptions(options, [], false, false);
    if (parsed === undefined) return invalidAuthCommand();
    return action === "status"
      ? { command: "auth-status" }
      : { command: "auth-logout" };
  }
  return invalidAuthCommand();
};
