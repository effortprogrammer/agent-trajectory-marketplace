const decodeXml = (value: string): string =>
	value
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&apos;", "'")
		.replaceAll("&amp;", "&");

const decodeSystemdValue = (value: string): string => {
	let decoded = "";
	for (let index = 0; index < value.length; index += 1) {
		const character = value[index];
		const next = value[index + 1];
		if (character === "%" && next === "%") {
			decoded += "%";
			index += 1;
			continue;
		}
		if (character !== "\\" || next === undefined) {
			decoded += character;
			continue;
		}
		if (next === "n") decoded += "\n";
		else if (next === "r") decoded += "\r";
		else if (next === "t") decoded += "\t";
		else if (next === '"') decoded += '"';
		else if (next === "\\") decoded += "\\";
		else decoded += `\\${next}`;
		index += 1;
	}
	return decoded;
};

export const telemetryEnvironmentFromService = (
	content: string,
	platform: NodeJS.Platform,
): Readonly<Record<string, string>> => {
	const variables: Record<string, string> = {};
	if (platform === "linux") {
		for (const match of content.matchAll(/^Environment="((?:\\.|[^"])*)"$/gm)) {
			const assignment = match[1];
			if (assignment === undefined) continue;
			const separator = assignment.indexOf("=");
			if (separator <= 0) continue;
			const key = assignment.slice(0, separator);
			if (!/^ATM_POSTHOG_[A-Z0-9_]+$/.test(key)) continue;
			variables[key] = decodeSystemdValue(assignment.slice(separator + 1));
		}
		return variables;
	}
	if (platform === "darwin") {
		for (const match of content.matchAll(
			/<key>(ATM_POSTHOG_[A-Z0-9_]+)<\/key>\s*<string>([\s\S]*?)<\/string>/g,
		)) {
			const key = match[1];
			const value = match[2];
			if (key !== undefined && value !== undefined) variables[key] = decodeXml(value);
		}
	}
	return variables;
};
