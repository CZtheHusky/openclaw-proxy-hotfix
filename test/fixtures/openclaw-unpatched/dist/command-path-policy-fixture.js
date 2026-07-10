function hasFlag(argv, flag) {
	return argv.includes(flag);
}
const cliCommandCatalog = [
	{
		commandPath: ["chat"],
		policy: { networkProxy: "bypass" }
	},
	{
		commandPath: ["terminal"],
		policy: { networkProxy: "bypass" }
	},
	{
		commandPath: ["tui"],
		policy: { networkProxy: "bypass" }
	}
];
function resolveCliNetworkProxyPolicy() {
	return "bypass";
}
export { resolveCliNetworkProxyPolicy };
