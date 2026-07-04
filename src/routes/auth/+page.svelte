<script lang="ts">
	import DOMPurify from 'dompurify';
	import { marked } from 'marked';

	import { toast } from 'svelte-sonner';

	import { onMount, getContext, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	import { getBackendConfig } from '$lib/apis';
	import {
		ldapUserSignIn,
		getSessionUser,
		userSignIn,
		userSignUp,
		updateUserTimezone
	} from '$lib/apis/auths';

	import { WEBUI_API_BASE_URL, WEBUI_BASE_URL } from '$lib/constants';
	import { WEBUI_NAME, config, user, socket } from '$lib/stores';

	import { generateInitialsImage, canvasPixelTest, getUserTimezone } from '$lib/utils';

	import Spinner from '$lib/components/common/Spinner.svelte';
	import OnBoarding from '$lib/components/OnBoarding.svelte';
	import SensitiveInput from '$lib/components/common/SensitiveInput.svelte';
	import { redirect } from '@sveltejs/kit';

	const i18n = getContext('i18n');

	let loaded = false;

	let mode = $config?.features.enable_ldap ? 'ldap' : 'signin';

	let form = null;

	let name = '';
	let email = '';
	let password = '';
	let confirmPassword = '';

	let ldapUsername = '';

	const setSessionUser = async (sessionUser, redirectPath: string | null = null) => {
		if (sessionUser) {
			console.log(sessionUser);
			toast.success($i18n.t(`You're now logged in.`));
			if (sessionUser.token) {
				localStorage.token = sessionUser.token;
			}
			$socket.emit('user-join', { auth: { token: sessionUser.token } });
			await user.set(sessionUser);
			await config.set(await getBackendConfig());

			// Update user timezone
			const timezone = getUserTimezone();
			if (sessionUser.token && timezone) {
				updateUserTimezone(sessionUser.token, timezone);
			}

			if (!redirectPath) {
				redirectPath = $page.url.searchParams.get('redirect') || '/';
			}

			goto(redirectPath);
			localStorage.removeItem('redirectPath');
		}
	};

	const signInHandler = async () => {
		const sessionUser = await userSignIn(email, password).catch((error) => {
			toast.error(`${error}`);
			return null;
		});

		await setSessionUser(sessionUser);
	};

	const signUpHandler = async () => {
		if ($config?.features?.enable_signup_password_confirmation) {
			if (password !== confirmPassword) {
				toast.error($i18n.t('Passwords do not match.'));
				return;
			}
		}

		const sessionUser = await userSignUp(name, email, password, generateInitialsImage(name)).catch(
			(error) => {
				toast.error(`${error}`);
				return null;
			}
		);

		await setSessionUser(sessionUser);
	};

	const ldapSignInHandler = async () => {
		const sessionUser = await ldapUserSignIn(ldapUsername, password).catch((error) => {
			toast.error(`${error}`);
			return null;
		});
		await setSessionUser(sessionUser);
	};

	const submitHandler = async () => {
		if (mode === 'ldap') {
			await ldapSignInHandler();
		} else if (mode === 'signin') {
			await signInHandler();
		} else {
			await signUpHandler();
		}
	};

	const oauthCallbackHandler = async () => {
		// Get the value of the 'token' cookie
		function getCookie(name) {
			const match = document.cookie.match(
				new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)')
			);
			return match ? decodeURIComponent(match[1]) : null;
		}

		const token = getCookie('token');
		if (!token) {
			return;
		}

		const sessionUser = await getSessionUser(token).catch((error) => {
			toast.error(`${error}`);
			return null;
		});

		if (!sessionUser) {
			return;
		}

		localStorage.token = token;
		await setSessionUser(sessionUser, localStorage.getItem('redirectPath') || null);
	};

	let onboarding = false;

	onMount(async () => {
		const redirectPath = $page.url.searchParams.get('redirect');
		if ($user !== undefined) {
			goto(redirectPath || '/');
		} else {
			if (redirectPath) {
				localStorage.setItem('redirectPath', redirectPath);
			}
		}

		const error = $page.url.searchParams.get('error');
		if (error) {
			toast.error(error);
		}

		await oauthCallbackHandler();
		form = $page.url.searchParams.get('form');

		// Auto-redirect to SSO when OAUTH_AUTO_REDIRECT is enabled and the
		// deployment is unambiguously SSO-only (single provider, no login form,
		// no LDAP). Suppressed by ?form=, ?error=, onboarding, trusted-header
		// auth, or an existing session/token.
		if ($config?.oauth?.auto_redirect && !form && !error) {
			const providers = Object.keys($config?.oauth?.providers ?? {});
			if (
				providers.length === 1 &&
				$config?.features?.auth !== false &&
				$config?.features?.enable_login_form === false &&
				!$config?.features?.enable_ldap &&
				!$config?.features?.auth_trusted_header &&
				!$config?.onboarding &&
				!localStorage.token &&
				!document.cookie.split('; ').some((c) => c.startsWith('token='))
			) {
				window.location.href = `${WEBUI_BASE_URL}/oauth/${providers[0]}/login`;
				return;
			}
		}

		loaded = true;

		if (($config?.features?.auth_trusted_header ?? false) || $config?.features?.auth === false) {
			await signInHandler();
		} else {
			onboarding = $config?.onboarding ?? false;
		}
	});
</script>

<svelte:head>
	<title>
		{`${$WEBUI_NAME}`}
	</title>
</svelte:head>

<OnBoarding
	bind:show={onboarding}
	getStartedHandler={() => {
		onboarding = false;
		mode = $config?.features.enable_ldap ? 'ldap' : 'signup';
	}}
/>

<div class="w-full h-screen max-h-[100dvh] relative" id="auth-page">
	<div class="w-full h-full absolute top-0 left-0 yfy-bg"></div>

	<div class="w-full absolute top-0 left-0 right-0 h-8 drag-region" />

	{#if loaded}
		<div
			class="fixed bg-transparent min-h-screen w-full flex justify-center items-center z-50"
			id="auth-container"
		>
			<div class="w-full px-4 sm:px-6 min-h-screen flex flex-col justify-center items-center">
				{#if ($config?.features.auth_trusted_header ?? false) || $config?.features.auth === false}
					<main class="yfy-shell">
						<div class="yfy-loading">
							<div>
								{$i18n.t('Signing in to {{WEBUI_NAME}}', { WEBUI_NAME: $WEBUI_NAME })}
							</div>
							<div>
								<Spinner className="size-5" />
							</div>
						</div>
					</main>
				{:else}
					<main class="yfy-shell" aria-label="{$WEBUI_NAME} 登入">
						<section class="yfy-card">
							<header class="card-top">
								<img
									class="card-top-curve"
									src="{WEBUI_BASE_URL}/static/bg_curve4.png"
									alt=""
									aria-hidden="true"
								/>
								<img
									id="logo"
									class="card-logo"
									crossorigin="anonymous"
									src="{WEBUI_BASE_URL}/static/YFYlogo_2.png"
									alt="{$WEBUI_NAME} logo"
								/>
								<div class="card-title">永豐餘 YFY AI 平台</div>
							</header>

							<div class="welcome">
								<strong>
									{#if mode === 'signup'}
										{($config?.onboarding ?? false)
											? $i18n.t('Create Admin Account')
											: $i18n.t('Create Account')}
									{:else}
										歡迎回來
									{/if}
								</strong>
								<span>
									{#if mode === 'ldap'}
										請使用您的公司帳號密碼登入
									{:else if mode === 'signin'}
										請使用您的 Email 登入
									{:else}
										請填寫以下資訊建立帳號
									{/if}
								</span>

								{#if $config?.onboarding ?? false}
									<span class="welcome-note">
										ⓘ {$WEBUI_NAME}
										{$i18n.t(
											'does not make any external connections, and your data stays securely on your locally hosted server.'
										)}
									</span>
								{/if}
							</div>

							<form
								class="login-form"
								on:submit={(e) => {
									e.preventDefault();
									submitHandler();
								}}
							>
								{#if $config?.features.enable_login_form || $config?.features.enable_ldap || form}
									{#if mode === 'signup'}
										<div class="login-row">
											<label class="login-label" for="name">{$i18n.t('Name')}</label>
											<input
												class="login-field"
												bind:value={name}
												type="text"
												id="name"
												autocomplete="name"
												placeholder={$i18n.t('Enter Your Full Name')}
												required
											/>
										</div>
									{/if}

									{#if mode === 'ldap'}
										<div class="login-row">
											<label class="login-label" for="username">{$i18n.t('Username')}</label>
											<input
												class="login-field"
												bind:value={ldapUsername}
												type="text"
												autocomplete="username"
												name="username"
												id="username"
												placeholder={$i18n.t('Enter Your Username')}
												required
											/>
										</div>
									{:else}
										<div class="login-row">
											<label class="login-label" for="email">{$i18n.t('Email')}</label>
											<input
												class="login-field"
												bind:value={email}
												type="email"
												id="email"
												autocomplete="email"
												name="email"
												placeholder={$i18n.t('Enter Your Email')}
												required
											/>
										</div>
									{/if}

									<div class="login-row">
										<label class="login-label" for="password">{$i18n.t('Password')}</label>
										<div class="login-field">
											<SensitiveInput
												bind:value={password}
												type="password"
												id="password"
												placeholder={$i18n.t('Enter Your Password')}
												autocomplete={mode === 'signup' ? 'new-password' : 'current-password'}
												name="password"
												screenReader={true}
												required
												outerClassName="flex flex-1 items-center bg-transparent"
												inputClassName="w-full bg-transparent outline-none text-[15px] text-[#262b2b] placeholder:text-[#7c8586]"
												showButtonClassName="flex items-center justify-center pl-2 text-[#262b2b] opacity-70 hover:opacity-100 transition bg-transparent"
											/>
										</div>
									</div>

									{#if mode === 'signup' && $config?.features?.enable_signup_password_confirmation}
										<div class="login-row">
											<label class="login-label" for="confirm-password"
												>{$i18n.t('Confirm Password')}</label
											>
											<div class="login-field">
												<SensitiveInput
													bind:value={confirmPassword}
													type="password"
													id="confirm-password"
													placeholder={$i18n.t('Confirm Your Password')}
													autocomplete="new-password"
													name="confirm-password"
													required
													outerClassName="flex flex-1 items-center bg-transparent"
													inputClassName="w-full bg-transparent outline-none text-[15px] text-[#262b2b] placeholder:text-[#7c8586]"
													showButtonClassName="flex items-center justify-center pl-2 text-[#262b2b] opacity-70 hover:opacity-100 transition bg-transparent"
												/>
											</div>
										</div>
									{/if}
								{/if}

								{#if $config?.features.enable_login_form || $config?.features.enable_ldap || form}
									{#if mode === 'ldap'}
										<button class="login-button" type="submit">
											{$i18n.t('Authenticate')}
										</button>
									{:else}
										<button class="login-button" type="submit">
											{mode === 'signin'
												? $i18n.t('Sign in')
												: ($config?.onboarding ?? false)
													? $i18n.t('Create Admin Account')
													: $i18n.t('Create Account')}
										</button>
									{/if}

									{#if $config?.features.enable_ldap && $config?.features.enable_login_form}
										<button
											class="login-switch"
											type="button"
											on:click={() => {
												if (mode === 'ldap')
													mode = ($config?.onboarding ?? false) ? 'signup' : 'signin';
												else mode = 'ldap';
											}}
										>
											{mode === 'ldap' ? $i18n.t('Continue with Email') : $i18n.t('Continue with LDAP')}
										</button>
									{/if}

									{#if mode !== 'ldap' && $config?.features.enable_signup && !($config?.onboarding ?? false)}
										<div class="login-signup-toggle">
											{mode === 'signin'
												? $i18n.t("Don't have an account?")
												: $i18n.t('Already have an account?')}
											<button
												type="button"
												on:click={() => {
													mode = mode === 'signin' ? 'signup' : 'signin';
												}}
											>
												{mode === 'signin' ? $i18n.t('Sign up') : $i18n.t('Sign in')}
											</button>
										</div>
									{/if}
								{/if}
							</form>

							{#if Object.keys($config?.oauth?.providers ?? {}).length > 0}
								<div class="yfy-divider">
									{#if $config?.features.enable_login_form || $config?.features.enable_ldap || form}
										<span>{$i18n.t('or')}</span>
									{/if}
								</div>

								<div class="oauth-list">
									{#if $config?.oauth?.providers?.google}
										<button
											class="oauth-button"
											on:click={() => {
												window.location.href = `${WEBUI_BASE_URL}/oauth/google/login`;
											}}
										>
											<svg
												xmlns="http://www.w3.org/2000/svg"
												viewBox="0 0 48 48"
												class="size-5 mr-3"
												aria-hidden="true"
											>
												<path
													fill="#EA4335"
													d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
												/><path
													fill="#4285F4"
													d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
												/><path
													fill="#FBBC05"
													d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
												/><path
													fill="#34A853"
													d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
												/><path fill="none" d="M0 0h48v48H0z" />
											</svg>
											<span>{$i18n.t('Continue with {{provider}}', { provider: 'Google' })}</span>
										</button>
									{/if}
									{#if $config?.oauth?.providers?.microsoft}
										<button
											class="oauth-button"
											on:click={() => {
												window.location.href = `${WEBUI_BASE_URL}/oauth/microsoft/login`;
											}}
										>
											<svg
												xmlns="http://www.w3.org/2000/svg"
												viewBox="0 0 21 21"
												class="size-5 mr-3"
												aria-hidden="true"
											>
												<rect x="1" y="1" width="9" height="9" fill="#f25022" /><rect
													x="1"
													y="11"
													width="9"
													height="9"
													fill="#00a4ef"
												/><rect x="11" y="1" width="9" height="9" fill="#7fba00" /><rect
													x="11"
													y="11"
													width="9"
													height="9"
													fill="#ffb900"
												/>
											</svg>
											<span>{$i18n.t('Continue with {{provider}}', { provider: 'Microsoft' })}</span>
										</button>
									{/if}
									{#if $config?.oauth?.providers?.github}
										<button
											class="oauth-button"
											on:click={() => {
												window.location.href = `${WEBUI_BASE_URL}/oauth/github/login`;
											}}
										>
											<svg
												xmlns="http://www.w3.org/2000/svg"
												viewBox="0 0 24 24"
												class="size-5 mr-3"
												aria-hidden="true"
											>
												<path
													fill="currentColor"
													d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.92 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57C20.565 21.795 24 17.31 24 12c0-6.63-5.37-12-12-12z"
												/>
											</svg>
											<span>{$i18n.t('Continue with {{provider}}', { provider: 'GitHub' })}</span>
										</button>
									{/if}
									{#if $config?.oauth?.providers?.oidc}
										<button
											class="oauth-button"
											on:click={() => {
												window.location.href = `${WEBUI_BASE_URL}/oauth/oidc/login`;
											}}
										>
											<svg
												xmlns="http://www.w3.org/2000/svg"
												fill="none"
												viewBox="0 0 24 24"
												stroke-width="1.5"
												stroke="currentColor"
												class="size-5 mr-3"
												aria-hidden="true"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z"
												/>
											</svg>
											<span
												>{$i18n.t('Continue with {{provider}}', {
													provider: $config?.oauth?.providers?.oidc ?? 'SSO'
												})}</span
											>
										</button>
									{/if}
									{#if $config?.oauth?.providers?.feishu}
										<button
											class="oauth-button"
											on:click={() => {
												window.location.href = `${WEBUI_BASE_URL}/oauth/feishu/login`;
											}}
										>
											<span>{$i18n.t('Continue with {{provider}}', { provider: 'Feishu' })}</span>
										</button>
									{/if}
								</div>
							{/if}

							{#if $config?.metadata?.login_footer}
								<div class="login-footer marked">
									{@html DOMPurify.sanitize(marked($config?.metadata?.login_footer))}
								</div>
							{/if}
						</section>
					</main>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.yfy-bg {
		background: linear-gradient(180deg, #e5e9eb 0%, #d2d8da 58%, #c5ccce 100%);
	}

	.yfy-shell {
		--yfy-ink: #262b2b;
		--yfy-radius: 24px;
		--yfy-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans TC', 'Microsoft JhengHei',
			Arial, sans-serif;

		width: min(100%, 410px);
		position: relative;
		z-index: 1;
		font-family: var(--yfy-font);
		color: var(--yfy-ink);
	}

	.yfy-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 24px;
		font-size: 20px;
		font-weight: 600;
		color: var(--yfy-ink);
	}

	.yfy-card {
		position: relative;
		overflow: hidden;
		width: 100%;
		padding: 0 28px 30px;
		background: linear-gradient(180deg, #eef1f2 0%, #fbfcfc 46%, #f7f9f9 100%);
		border: 1px solid rgba(255, 255, 255, 0.72);
		border-radius: var(--yfy-radius);
		box-shadow: 0 18px 42px rgba(36, 43, 43, 0.18);
	}

	.card-top {
		position: relative;
		height: 160px;
		margin: 0 -28px 22px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		background: #323637;
		border-radius: var(--yfy-radius) var(--yfy-radius) 0 0;
	}

	.card-top-curve {
		position: absolute;
		z-index: 1;
		left: 50%;
		bottom: -14px;
		width: 126%;
		height: auto;
		transform: translateX(-50%);
		pointer-events: none;
	}

	.card-top::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 2;
		pointer-events: none;
		background: linear-gradient(
			180deg,
			#323637 0%,
			rgba(50, 54, 55, 0.82) 12%,
			rgba(50, 54, 55, 0.42) 34%,
			rgba(50, 54, 55, 0.14) 58%,
			rgba(50, 54, 55, 0) 82%
		);
	}

	.card-logo {
		position: relative;
		z-index: 3;
		width: 56px;
		height: 56px;
		object-fit: contain;
		filter: drop-shadow(0 3px 3px rgba(0, 0, 0, 0.18));
	}

	.card-title {
		position: relative;
		z-index: 3;
		margin-top: 16px;
		color: #ffffff;
		font-size: 20px;
		font-weight: 600;
		line-height: 1.35;
		letter-spacing: -0.025em;
		text-align: center;
		white-space: nowrap;
	}

	.welcome {
		margin: 0 0 18px;
		text-align: center;
		line-height: 1.7;
	}

	.welcome strong {
		display: block;
		margin-bottom: 2px;
		color: var(--yfy-ink);
		font-size: 19px;
		font-weight: 700;
		line-height: 1.35;
	}

	.welcome span {
		display: block;
		color: #707879;
		font-size: 14px;
		font-weight: 400;
	}

	.welcome .welcome-note {
		margin-top: 8px;
		font-size: 12px;
		color: #8a9192;
	}

	.login-form {
		width: 100%;
		padding: 20px 0 0;
		margin: 0;
	}

	.login-row {
		width: 100%;
		margin: 0 0 18px;
	}

	.login-label {
		display: block;
		margin: 0 0 8px;
		color: var(--yfy-ink);
		font-size: 14px;
		font-weight: 600;
		line-height: 1.25;
		text-align: left;
	}

	.login-field {
		display: flex;
		align-items: center;
		width: 100%;
		height: 40px;
		padding: 0 12px;
		border: 1px solid rgba(38, 43, 43, 0.18);
		border-radius: 10px;
		background: transparent;
		color: var(--yfy-ink);
		font-size: 15px;
		font-weight: 400;
	}

	input.login-field {
		outline: 0;
	}

	input.login-field::placeholder {
		color: #7c8586;
		font-size: 14px;
		font-weight: 400;
		opacity: 0.68;
	}

	input.login-field:focus,
	.login-field:focus-within {
		border-color: rgba(50, 54, 55, 0.42);
	}

	.login-button {
		width: 100%;
		height: 44px;
		margin: 18px 0 0;
		border: 1px solid #7c8586;
		border-radius: 12px;
		cursor: pointer;
		color: #323637;
		background: #eaeeef;
		font-size: 15px;
		font-weight: 700;
		letter-spacing: 0.04em;
		box-shadow: 0 1px 2px rgba(36, 43, 43, 0.12);
		transition:
			color 0.2s ease,
			background 0.2s ease,
			border-color 0.2s ease,
			box-shadow 0.2s ease;
	}

	.login-button:hover {
		color: #ffffff;
		background: #404445;
		border-color: #404445;
		box-shadow: 0 2px 6px rgba(36, 43, 43, 0.16);
	}

	.login-switch {
		display: block;
		width: fit-content;
		margin: 16px auto 0;
		border: 0;
		padding: 0;
		color: var(--yfy-ink);
		background: transparent;
		cursor: pointer;
		font-size: 14px;
		font-weight: 600;
		line-height: 1.35;
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.login-switch:hover,
	.login-switch:focus-visible {
		color: #e7741d;
	}

	.login-signup-toggle {
		margin-top: 14px;
		text-align: center;
		font-size: 14px;
		color: #707879;
	}

	.login-signup-toggle button {
		border: 0;
		padding: 0;
		background: transparent;
		color: var(--yfy-ink);
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}

	.login-signup-toggle button:hover {
		color: #e7741d;
	}

	.yfy-divider {
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 18px 0 14px;
	}

	.yfy-divider::before,
	.yfy-divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: rgba(38, 43, 43, 0.12);
	}

	.yfy-divider span {
		padding: 0 12px;
		color: #707879;
		font-size: 13px;
		font-weight: 500;
	}

	.oauth-list {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.oauth-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 44px;
		border: 1px solid rgba(38, 43, 43, 0.18);
		border-radius: 12px;
		background: #fbfcfc;
		color: #323637;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 0.2s ease,
			border-color 0.2s ease;
	}

	.oauth-button:hover {
		background: #eef1f2;
		border-color: rgba(38, 43, 43, 0.3);
	}

	.login-footer {
		margin-top: 16px;
		text-align: center;
		font-size: 12px;
		color: #707879;
	}

	@media (max-width: 560px) {
		.yfy-card {
			padding: 0 22px 28px;
		}

		.card-top {
			margin-left: -22px;
			margin-right: -22px;
			height: 164px;
		}

		.card-logo {
			width: 54px;
			height: 54px;
		}

		.card-title {
			font-size: 18px;
		}
	}
</style>
