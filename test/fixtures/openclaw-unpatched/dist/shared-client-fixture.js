async function refreshCodexAppServerAuthTokens() {
	return {};
}
async function applyCodexAppServerAuthProfile(params) {
	return params;
}
async function resolveCodexAppServerClientStartContext() {
	return {};
}
async function acquireSharedCodexAppServerClient(options, leaseOptions) {
	const { agentDir, usesNativeAuth, authProfileId, startOptions } = await resolveCodexAppServerClientStartContext(options);
	const entry = {};
	const sharedPromise = entry.promise ?? (entry.promise = (async () => {
		const client = CodexAppServerClient.start(startOptions);
		entry.client = client;
		options?.onStartedClient?.(client);
		client.setActiveSharedLeaseCountProviderForUnscopedNotifications(() => entry.activeLeases);
		try {
			await client.initialize();
			await applyCodexAppServerAuthProfile({
				client,
				agentDir,
				authProfileId: usesNativeAuth ? null : authProfileId,
				startOptions,
				config: options?.config
			});
			return client;
		} catch (error) {
			client.close();
			throw error;
		}
	})());
	return { client: await sharedPromise };
}
async function createIsolatedCodexAppServerClient(options) {
	const { agentDir, usesNativeAuth, authProfileId, authProfileStore, startOptions } = await resolveCodexAppServerClientStartContext(options);
	const client = CodexAppServerClient.start(startOptions);
	if (authProfileId) client.addRequestHandler(async (request) => {
		if (request.method !== "account/chatgptAuthTokens/refresh") return;
		return await refreshCodexAppServerAuthTokens({
			agentDir,
			authProfileId,
			...authProfileStore ? { authProfileStore } : {},
			config: options?.config
		});
	});
	await applyCodexAppServerAuthProfile({
		client,
		agentDir,
		authProfileId: usesNativeAuth ? null : authProfileId,
		startOptions,
		config: options?.config,
		...authProfileStore ? { authProfileStore } : {}
	});
	return client;
}
export { acquireSharedCodexAppServerClient, createIsolatedCodexAppServerClient };
