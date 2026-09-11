<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Digital Identity Issuer — Credentials Portal</title>
  <link rel="stylesheet" href="welcome-content/issuer.css">
</head>
<body>
  <header>
    <div class="brand">Digital Identity Issuer Portal</div>
    <div class="role">Keycloak OID4VCI &middot; Multi-Credential Issuer</div>
  </header>

  <main>
    <h1>Collect your Verifiable Credentials</h1>
    <p class="lede">
      Sign in once with your credentials to issue official digital credentials into your digital wallet (wwWallet).
      You can collect both your Google Employee Badge and Lilavati Hospital Medical Certificate from this page.
    </p>

    <section id="step-login" hidden>
      <div class="cred-cards">
        <div class="cred-preview-card">
          <div class="cred-preview-icon">🏢</div>
          <div>
            <div class="cred-preview-title">Google Employee Badge</div>
            <div class="cred-preview-sub">Corporate ID &bull; SD-JWT VC (dc+sd-jwt)</div>
          </div>
        </div>
        <div class="cred-preview-card">
          <div class="cred-preview-icon">🏥</div>
          <div>
            <div class="cred-preview-title">Lilavati Hospital Medical Certificate</div>
            <div class="cred-preview-sub">Health & Fitness &bull; SD-JWT VC (dc+sd-jwt)</div>
          </div>
        </div>
      </div>

      <button id="login" class="primary">Sign in to collect credentials</button>
      <p class="hint">Demo accounts: <code>ronak</code>, <code>raj</code>, <code>milan</code> &mdash; password <code>workshop</code></p>
    </section>

    <section id="step-offer" hidden>
      <p class="who">Signed in as <strong id="who"></strong></p>

      <!-- Credential Switcher Tabs -->
      <div class="cred-switcher">
        <button id="tab-employee-badge" class="cred-tab active">
          <span class="cred-tab-icon">🏢</span>
          <span class="cred-tab-name">Google Employee Badge</span>
        </button>
        <button id="tab-medical-certificate" class="cred-tab">
          <span class="cred-tab-icon">🏥</span>
          <span class="cred-tab-name">Lilavati Medical Certificate</span>
        </button>
      </div>

      <!-- Active Credential Banner -->
      <div class="cred-banner" id="cred-banner">
        <div class="cred-banner-info">
          <h3 id="cred-banner-title">Google Employee Badge</h3>
          <p id="cred-banner-desc">Verified corporate identity credential for building access and discounts.</p>
        </div>
        <div class="cred-format-tag" id="cred-format-tag">dc+sd-jwt</div>
      </div>

      <h2>1 &middot; Your credential offer</h2>
      <p class="hint">Copy this into your wallet, or scan the code.</p>

      <div class="offer">
        <div class="offer-text">
          <p>
            <a id="open-wallet" class="primary button-link" href="#">Open in my wallet &rarr;</a>
          </p>
          <p class="hint">
            Directly opens your wallet with this offer &mdash; no copy&ndash;paste needed.
          </p>

          <label for="uri">Offer link <span class="tag">by value</span></label>
          <textarea id="uri" readonly rows="4"></textarea>
          <button id="copy" class="primary">Copy offer link</button>

          <details>
            <summary>Alternative: offer <em>by reference</em></summary>
            <textarea id="uri-ref" readonly rows="3"></textarea>
            <p class="hint">
              Same offer, passed as a URL the wallet must fetch. Some wallets only
              accept one of these two forms.
            </p>
          </details>
        </div>
        <div class="offer-qr">
          <img id="qr" alt="Credential offer QR code">
          <p class="hint">Rendered by Keycloak</p>
        </div>
      </div>

      <h2>2 &middot; What the wallet will do with it</h2>
      <p class="hint">
        The link is only the handover. The wallet then talks to Keycloak directly:
        redeem the pre-authorized code, fetch a nonce, prove it holds a key, and
        collect the signed credential.
      </p>
      <pre id="offer-json"></pre>

      <button id="again" class="secondary">Regenerate offer</button>
    </section>

    <section id="step-error" hidden>
      <h2>Something went wrong</h2>
      <pre id="error"></pre>
      <button id="clear-state" class="primary" hidden>Clear sign-in state</button>
      <button id="retry" class="secondary">Start again</button>
    </section>
  </main>

  <script src="welcome-content/offer.js"></script>
</body>
</html>
