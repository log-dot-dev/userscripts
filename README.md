# Release Compare Restorer

A small, public userscript collection. The first script restores a link on GitHub release pages:

`N commits to <default branch> since this release`

The link opens GitHub's normal three-dot comparison view: `<tag>...<default branch>`.

## Install with Tampermonkey

1. Install the Tampermonkey extension in Chrome.
2. Open the raw [`release-compare-restorer.user.js`](https://raw.githubusercontent.com/log-dot-dev/userscripts/main/release-compare-restorer.user.js) URL and accept Tampermonkey's install prompt.
3. Ensure the script is enabled, then open any `https://github.com/<owner>/<repo>/releases/tag/<tag>` page.

Tampermonkey checks the script's published `@updateURL`; accepted updates install automatically.

## Install on all of your Chromes

Configure Tampermonkey Script Sync once, then enable it on each Chrome:

1. Tampermonkey dashboard → **Settings** → set Config Mode to **Beginner** or **Advanced**.
2. Find **Script Sync**, select Google Drive, Dropbox, or WebDAV, then enable it and save.
3. Install Tampermonkey on each Chrome profile and enable the same Script Sync provider.

Browser Sync also exists, but it requires a publicly hosted script with a valid `@downloadURL`; this local script deliberately does not have one.

For repositories you can access, it reads GitHub's normal repository and comparison pages using your existing signed-in browser session. This covers private repositories without a token. No analytics, remote code, API token, or data collection.

## Limits

- GitHub can change page markup. If the commit count cannot be extracted, the extension still renders the authenticated comparison link.
- The earlier Manifest V3 extension files remain in this folder as an alternative, but the userscript is the recommended path.
