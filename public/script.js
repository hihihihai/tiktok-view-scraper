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

  // Extract profile URL from video/other subpages
  const profileMatch = url.match(/^(https?:\/\/(www\.)?tiktok\.com\/@[\w.]+)/);
  if (profileMatch) {
    url = profileMatch[1];
  } else {
    showError(
      "올바른 TikTok URL을 입력해주세요.\n예: https://www.tiktok.com/@username 또는 영상 링크"
    );
    return;
  }

  setButtonDisabled(true);
  showLoading(true);

  try {
    const res = await fetch("/.netlify/functions/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileUrl: url }),
    });

    const data = await res.json();

    if (data.status === "complete") {
      renderResults(data.data);
    } else if (data.status === "error") {
      showError(data.message);
    } else {
      showError("알 수 없는 응답입니다. 다시 시도해주세요.");
    }
  } catch (err) {
    showError("네트워크 오류가 발생했습니다. 인터넷 연결을 확인해주세요.");
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
