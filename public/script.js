const POLL_INTERVAL = 3000; // 3초
const POLL_TIMEOUT = 90000; // 90초

function showError(message) {
  const el = document.getElementById("error");
  el.textContent = message;
  el.classList.remove("hidden");
}

function hideError() {
  document.getElementById("error").classList.add("hidden");
}

function showLoading(show) {
  const el = document.getElementById("loading");
  if (show) {
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

function setButtonDisabled(disabled) {
  const btn = document.getElementById("scrapeBtn");
  btn.disabled = disabled;
  btn.textContent = disabled ? "조회 중..." : "조회";
}

function formatNumber(num) {
  if (typeof num === "string") return num;
  if (num === null || num === undefined) return "N/A";
  return num.toLocaleString("ko-KR");
}

function formatDate(timestamp) {
  if (!timestamp) return "N/A";
  const date = new Date(timestamp * 1000);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function renderResults(data) {
  const { followerCount, videos } = data;

  // Follower count
  document.getElementById("followerCount").textContent =
    formatNumber(followerCount);

  // View counts - tab separated for Excel
  const rawCounts = videos.map((v) =>
    typeof v.playCount === "number" ? v.playCount : v.playCount
  );
  document.getElementById("viewCounts").value = rawCounts.join("\t");

  // Video table
  const tbody = document.getElementById("videoBody");
  tbody.innerHTML = "";

  videos.forEach((video, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${formatDate(video.createTime)}</td>
      <td>${formatNumber(video.playCount)}</td>
      <td title="${video.desc}">${video.desc || "-"}</td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById("results").classList.remove("hidden");
}

function copyToClipboard() {
  const input = document.getElementById("viewCounts");
  input.select();
  navigator.clipboard.writeText(input.value).then(() => {
    const feedback = document.getElementById("copyFeedback");
    feedback.classList.remove("hidden");
    setTimeout(() => feedback.classList.add("hidden"), 2000);
  });
}

async function pollResult(requestId) {
  const startTime = Date.now();

  while (Date.now() - startTime < POLL_TIMEOUT) {
    try {
      const res = await fetch(
        `/.netlify/functions/scrape-result?requestId=${requestId}`
      );
      const data = await res.json();

      if (data.status === "complete") {
        return data.data;
      }

      if (data.status === "error") {
        throw new Error(data.message);
      }

      // Still pending - wait and retry
    } catch (err) {
      if (err.message && !err.message.includes("fetch")) {
        throw err;
      }
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }

  throw new Error(
    "요청 시간이 초과되었습니다 (90초). TikTok 서버가 느리거나 차단되었을 수 있습니다. 잠시 후 다시 시도해주세요."
  );
}

async function startScrape() {
  const input = document.getElementById("profileUrl");
  let url = input.value.trim();

  // Reset UI
  hideError();
  document.getElementById("results").classList.add("hidden");

  // Basic validation
  if (!url) {
    showError("TikTok 프로필 URL을 입력해주세요.");
    return;
  }

  // Auto-fix common patterns
  if (url.startsWith("@")) {
    url = "https://www.tiktok.com/" + url;
  } else if (!url.startsWith("http")) {
    url = "https://www.tiktok.com/@" + url;
  }

  // Remove query params and trailing slashes
  url = url.split("?")[0].replace(/\/+$/, "");

  const urlPattern = /^https?:\/\/(www\.)?tiktok\.com\/@[\w.]+$/;
  if (!urlPattern.test(url)) {
    showError(
      "올바른 TikTok 프로필 URL을 입력해주세요.\n예: https://www.tiktok.com/@username 또는 @username"
    );
    return;
  }

  const requestId = crypto.randomUUID();

  setButtonDisabled(true);
  showLoading(true);

  try {
    // Trigger background scrape
    const res = await fetch("/.netlify/functions/scrape-background", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileUrl: url, requestId }),
    });

    if (!res.ok && res.status !== 202) {
      throw new Error(`서버 오류 (${res.status}). 잠시 후 다시 시도해주세요.`);
    }

    // Poll for results
    const data = await pollResult(requestId);
    renderResults(data);
  } catch (err) {
    showError(err.message);
  } finally {
    setButtonDisabled(false);
    showLoading(false);
  }
}

// Allow Enter key to trigger scrape
document.getElementById("profileUrl").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    startScrape();
  }
});
