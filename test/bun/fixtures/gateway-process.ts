export const officialGatewayProcessArguments = (
  argumentsList: readonly string[],
): Readonly<{ readonly argumentsList: string[]; readonly target?: string }> => {
  const serverIndex = argumentsList.indexOf("--server");
  if (serverIndex < 0) return { argumentsList: [...argumentsList] };
  const target = argumentsList[serverIndex + 1];
  const targetUrl = target === undefined ? undefined : new URL(target);
  if (
    target === undefined ||
    target.startsWith("--") ||
    argumentsList.indexOf("--server", serverIndex + 1) >= 0 ||
    targetUrl?.hostname !== "127.0.0.1" ||
    targetUrl.pathname !== "/"
  ) {
    return { argumentsList: [...argumentsList] };
  }
  return {
    argumentsList: (() => {
      const stripped = [
      ...argumentsList.slice(0, serverIndex),
      ...argumentsList.slice(serverIndex + 2),
      ];
      const bunIndex = stripped.indexOf(process.execPath);
      if (bunIndex < 0) return stripped;
      return [
        ...stripped.slice(0, bunIndex + 1),
        "--preload",
        `${import.meta.dir}/gateway-fetch-preload.ts`,
        ...stripped.slice(bunIndex + 1),
      ];
    })(),
    target,
  };
};

export const officialGatewayProcessEnvironment = (
  target: string | undefined,
): Readonly<Record<string, string>> =>
  target === undefined
    ? {}
    : {
        TRAJECTORY_TEST_GATEWAY_TARGET: target,
      };
