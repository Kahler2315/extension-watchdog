const extensionCount = document.querySelector("#extension-count");
const reviewCount = document.querySelector("#review-count");
const changeCount = document.querySelector("#change-count");
const status = document.querySelector("#popup-status");
const dashboardButton = document.querySelector("#dashboard-button");

function needsReview(extension, changes) {
  return (
    ["critical", "high"].includes(extension.analysis.level) ||
    changes.some((change) => {
      return change.extensionId === extension.id && !change.reviewed;
    })
  );
}

async function loadSummary() {
  try {
    const state = await browser.runtime.sendMessage({ type: "get-state" });
    const unreviewedChanges = state.changes.filter((change) => !change.reviewed);
    extensionCount.textContent = String(state.extensions.length);
    reviewCount.textContent = String(
      state.extensions.filter((extension) => {
        return needsReview(extension, state.changes);
      }).length
    );
    changeCount.textContent = String(unreviewedChanges.length);
    status.textContent = state.scannedAt
      ? `Last checked ${new Date(state.scannedAt).toLocaleString()}`
      : "Ready to create a baseline.";
  } catch (error) {
    console.error(error);
    status.textContent = "Unable to read extension metadata.";
  }
}

dashboardButton.addEventListener("click", async () => {
  await browser.runtime.openOptionsPage();
  window.close();
});

loadSummary();
