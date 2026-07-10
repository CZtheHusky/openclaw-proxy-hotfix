import { r as fetchWithSsrFGuard } from "./fetch-guard-fixture.js";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
async function postTokenForm(body, options = {}) {
	const timeoutMs = options.timeoutMs ?? 3e4;
	const { response, release } = await fetchWithSsrFGuard({
		url: TOKEN_URL,
		init: {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body
		},
		timeoutMs,
		signal: options.signal,
		auditContext: "openai-chatgpt-oauth-token"
	});
	try {
		return response;
	} finally {
		await release();
	}
}
export { postTokenForm };
