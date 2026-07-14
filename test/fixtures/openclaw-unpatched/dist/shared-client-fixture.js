async function refreshCodexAppServerAuthTokens(params) {
	return params;
}
const configuredClients = /* @__PURE__ */ new WeakMap();
function ensureCodexAppServerClientRuntime(client, context) {
	const existing = configuredClients.get(client);
	if (existing) {
		existing.context = context;
		return;
	}
	const runtime = { context };
	configuredClients.set(client, runtime);
	client.addRequestHandler(async (request) => {
		if (request.method !== "account/chatgptAuthTokens/refresh") return;
		return await refreshCodexAppServerAuthTokens({
			agentDir: runtime.context.agentDir,
			authProfileId: runtime.context.authProfileId,
			...runtime.context.authProfileStore ? { authProfileStore: runtime.context.authProfileStore } : {},
			config: runtime.context.config
		});
	});
}
async function resolveCodexAppServerClientStartContext() {
	return {};
}
async function startInitializedCodexAppServerClient(params) {
	const client = CodexAppServerClient.start(params.startOptions);
	ensureCodexAppServerClientRuntime(client, {
		agentDir: params.agentDir,
		authProfileId: params.authProfileId ?? void 0,
		...params.authProfileStore ? { authProfileStore: params.authProfileStore } : {},
		config: params.config
	});
	return client;
}
async function acquireSharedCodexAppServerClient(options, leaseOptions) {
	const { agentDir, usesNativeAuth, authProfileId, startOptions } = await resolveCodexAppServerClientStartContext(options);
	const entry = {};
	const sharedPromise = entry.promise ?? (entry.promise = (async () => {
		const client = await startInitializedCodexAppServerClient({
			startOptions,
			agentDir,
			authProfileId: usesNativeAuth ? null : authProfileId,
			config: options?.config,
			onStartedClient: options?.onStartedClient
		});
		entry.client = client;
		return client;
	})());
	try {
		const client = await sharedPromise;
		ensureCodexAppServerClientRuntime(client, {
			agentDir,
			authProfileId: usesNativeAuth ? void 0 : authProfileId,
			config: options?.config
		});
		return { client };
	} catch (error) {
		throw error;
	}
}
async function createIsolatedCodexAppServerClient(options) {
	return await startInitializedCodexAppServerClient(options);
}
export { acquireSharedCodexAppServerClient, createIsolatedCodexAppServerClient, ensureCodexAppServerClientRuntime };
