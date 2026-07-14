async function startCodexAttemptThread(params) {
	const startupClient = await params.attemptClientFactory({
		startOptions: params.appServer.start,
		authProfileId: params.startupAuthProfileId,
		agentDir: params.agentDir,
		config: params.config,
		onStartedClient: params.onStartedClient
	});
	ensureCodexAppServerClientRuntime(startupClient, {
		agentDir: params.agentDir,
		authProfileId: params.startupAuthProfileId,
		config: params.config
	});
	return startupClient;
}
async function runCodexAttempt(params) {
	const agentDir = params.agentDir;
	const startupAuthProfileId = params.authProfileStore ? params.authProfileId : void 0;
	const startupEnvApiKeyCacheKey = params.startupEnvApiKeyCacheKey;
	return await startCodexAttemptThread({
		attemptClientFactory: params.attemptClientFactory,
		startupAuthProfileId,
		startupAuthAccountCacheKey: params.startupAuthAccountCacheKey,
		startupEnvApiKeyCacheKey,
		agentDir,
		config: params.config
	});
}
export { runCodexAttempt, startCodexAttemptThread };
