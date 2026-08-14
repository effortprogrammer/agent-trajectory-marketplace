export const officialGatewayProcessArguments = (
  argumentsList: readonly string[],
  target?: string,
): Readonly<{ readonly argumentsList: string[]; readonly target?: string }> => {
  if (target === undefined) return { argumentsList: [...argumentsList] };
  if (target !== undefined) {
    const targetUrl = new URL(target);
    if (targetUrl.hostname !== "127.0.0.1" || targetUrl.pathname !== "/") {
      return { argumentsList: [...argumentsList] };
    }
  }
  return {
    argumentsList: (() => {
      const rewritten = [...argumentsList];
      const bunIndex = rewritten.indexOf(process.execPath);
      if (bunIndex < 0) return rewritten;
      return [
        ...rewritten.slice(0, bunIndex + 1),
        "--preload",
        `${import.meta.dir}/gateway-fetch-preload.ts`,
        ...rewritten.slice(bunIndex + 1),
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
