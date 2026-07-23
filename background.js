"use strict";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "github-api" || typeof message.path !== "string") return;

  fetch(`https://api.github.com${message.path}`, {
    headers: { Accept: "application/vnd.github+json" }
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`GitHub API request failed: ${response.status}`);
      return response.json();
    })
    .then((data) => sendResponse({ data }))
    .catch((error) => sendResponse({ error: error.message }));

  return true;
});
