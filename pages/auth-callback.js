const config = window.APP_CONFIG;
const supabaseClient = window.supabase.createClient(
  config.SUPABASE_URL,
  config.SUPABASE_ANON_KEY
);

async function claimGuestRedeems(accessToken) {
  try {
    const res = await fetch(`${config.API_BASE}/api/claim-guest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: "include",
    });
    if (!res.ok) {
      console.warn("claim-guest failed", res.status);
      return;
    }
    const data = await res.json();
    console.log("claim-guest claimed:", data?.claimed ?? 0);
  } catch (error) {
    console.warn("claim-guest error", error);
  }
}

async function handleAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const next = "/me.html";
  const code = params.get("code");
  const status = document.getElementById("callbackStatus");

  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const hashError = hashParams.get("error_description") || hashParams.get("error");
  if (hashError && status) {
    status.textContent = `セッション確立に失敗しました: ${hashError}`;
    return;
  }

  if (code) {
    const { error } = await supabaseClient.auth.exchangeCodeForSession(code);
    if (error) {
      if (status) {
        status.textContent = `セッション確立に失敗しました: ${error.message}`;
      }
      return;
    }
    window.localStorage.setItem("login_success", "1");
  }

  const tryRedirect = async () => {
    const { data } = await supabaseClient.auth.getSession();
    const accessToken = data?.session?.access_token;
    if (!accessToken) {
      if (status) status.textContent = "セッションを確認中...";
      return false;
    }
    await claimGuestRedeems(accessToken);
    window.location.href = next;
    return true;
  };

  if (await tryRedirect()) return;

  const { data: authListener } = supabaseClient.auth.onAuthStateChange(
    async (event) => {
      if (event === "SIGNED_IN") {
        await tryRedirect();
      }
    }
  );

  setTimeout(async () => {
    const done = await tryRedirect();
    if (!done && status) {
      status.textContent = "セッション確立に失敗しました。";
    }
    authListener?.subscription?.unsubscribe();
  }, 2000);

  if (status) status.textContent = "セッションを確立しています。";
}

handleAuthCallback();
