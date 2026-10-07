<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Log in | Outwork</title>
<meta name="robots" content="noindex">
<meta name="referrer" content="same-origin">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">
<link rel="stylesheet" href="outwork.css">
<link rel="stylesheet" href="dashboard.css">
</head>
<body data-page="login">
<nav class="nav"><div class="wrap-w nav-in"><a class="brand" href="index.html"><i><svg viewBox="0 0 24 24"><path d="M4 20l6-16 4 9 2-4 4 11z"/></svg></i>Outwork</a>
<div class="nav-right"><a class="nav-link" href="signup.html">Sign up</a></div></div></nav>
<main class="auth-page">
  <div class="auth-side band--orange ptsec"><div class="ptsec-bg" aria-hidden="true"><svg viewBox="0 0 1600 1400" preserveAspectRatio="xMidYMid slice"><g transform="translate(1180 520) rotate(-18)"><rect class="field" x="-310" y="-125" width="620" height="250" rx="125"/><rect class="lane" x="-310" y="-125" width="620" height="250" rx="125"/><rect class="lane" x="-425" y="-240" width="850" height="480" rx="240"/><rect class="lane lane--k" x="-540" y="-355" width="1080" height="710" rx="355"/><rect class="lane" x="-655" y="-470" width="1310" height="940" rx="470"/><rect class="lane" x="-770" y="-585" width="1540" height="1170" rx="585"/><rect class="lane lane--k" x="-885" y="-700" width="1770" height="1400" rx="700"/><rect class="lane" x="-1000" y="-815" width="2000" height="1630" rx="815"/><rect class="lane" x="-1115" y="-930" width="2230" height="1860" rx="930"/><rect class="runner " pathLength="1000" x="-425" y="-240" width="850" height="480" rx="240"/><rect class="runner runner--k" pathLength="1000" x="-770" y="-585" width="1540" height="1170" rx="585"/><rect class="runner " pathLength="1000" x="-1000" y="-815" width="2000" height="1630" rx="815"/></g></svg></div>
    <div><h1 class="h-xl">Welcome back.</h1><p class="lede">Log in to see your leaderboard.</p></div>
  </div>
  <div class="auth-main">
    <!-- A plain form. It posts straight to the server over HTTPS. No script touches the password. -->
    <form class="auth" method="post" action="/account/login">
      <p class="ok-box" id="formOk" role="status" hidden></p>
      <h2 class="h-md">Log in</h2>
      <div class="field"><label for="a-email">Email</label><input class="input" id="a-email" name="email" type="email" inputmode="email" maxlength="200" autocomplete="email" required></div><div class="field"><label for="a-pass">Password</label><input class="input" id="a-pass" name="password" type="password" maxlength="200" autocomplete="current-password" required></div><input type="hidden" name="code">
      <p class="err" id="formErr" role="alert"></p>
      <button class="btn btn--orange btn--block" type="submit">Log in</button>
      <p class="forgot"><a href="forgot.html">Forgot your password?</a></p><p class="auth-switch">New to Outwork? <a href="signup.html" data-keep-code>Sign up</a></p>
    </form>
  </div>
</main>
<script src="auth.js"></script>
</body>
</html>
