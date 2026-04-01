import chromium from "@sparticuz/chromium-min";
import puppeteer from "puppeteer-core";
import { getStore } from "@netlify/blobs";

const CHROMIUM_PACK_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar";

export default async (req, context) => {
  // Background functions only accept POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const { profileUrl, requestId } = body;

  if (!requestId) {
    return new Response("Missing requestId", { status: 400 });
  }

  const store = getStore("scrape-results");

  // Mark as pending
  await store.setJSON(requestId, { status: "pending" });

  // Validate URL
  const urlPattern = /^https?:\/\/(www\.)?tiktok\.com\/@[\w.]+\/?$/;
  if (!profileUrl || !urlPattern.test(profileUrl)) {
    await store.setJSON(requestId, {
      status: "error",
      message:
        "올바른 TikTok 프로필 URL을 입력해주세요 (예: https://www.tiktok.com/@username)",
    });
    return new Response("done", { status: 200 });
  }

  let browser = null;

  try {
    // Launch browser
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1280, height: 720 },
      executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
      headless: "shell",
    });

    const page = await browser.newPage();

    // Anti-bot: realistic headers
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    });

    // Hide webdriver
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });

    // Navigate to profile
    await page.goto(profileUrl, {
      waitUntil: "networkidle0",
      timeout: 60000,
    });

    // Strategy 1: Extract from embedded JSON
    let result = await page.evaluate(() => {
      const script = document.querySelector(
        "#__UNIVERSAL_DATA_FOR_REHYDRATION__"
      );
      if (!script) return null;

      try {
        const json = JSON.parse(script.textContent);
        const scope = json?.["__DEFAULT_SCOPE__"];

        // Extract user info
        const userDetail = scope?.["webapp.user-detail"];
        const userInfo = userDetail?.userInfo;
        const stats = userInfo?.stats;
        const followerCount = stats?.followerCount;

        // Extract video list
        const itemList = userDetail?.itemList || [];

        if (itemList.length === 0) return null;

        const videos = itemList.slice(0, 7).map((item) => ({
          id: item.id,
          desc: item.desc || "",
          playCount: item.stats?.playCount ?? 0,
          createTime: item.createTime,
        }));

        return { followerCount, videos, source: "json" };
      } catch {
        return null;
      }
    });

    // Strategy 2: DOM scraping fallback
    if (!result || result.videos.length === 0) {
      // Wait for video items to load
      await page
        .waitForSelector('[data-e2e="user-post-item"]', { timeout: 15000 })
        .catch(() => null);

      result = await page.evaluate(() => {
        // Follower count
        const followerEl = document.querySelector(
          '[data-e2e="followers-count"]'
        );
        const followerCount = followerEl?.textContent?.trim() || "N/A";

        // Video items
        const videoEls = document.querySelectorAll(
          '[data-e2e="user-post-item"]'
        );
        if (videoEls.length === 0) return null;

        const videos = [];
        const items = Array.from(videoEls).slice(0, 7);

        for (const el of items) {
          const viewEl = el.querySelector('[data-e2e="video-views"]');
          const playCount = viewEl?.textContent?.trim() || "0";

          videos.push({
            id: "",
            desc: el.getAttribute("title") || "",
            playCount,
            createTime: null,
          });
        }

        return { followerCount, videos, source: "dom" };
      });
    }

    if (!result || result.videos.length === 0) {
      // Check if profile exists
      const pageContent = await page.content();
      if (
        pageContent.includes("Couldn't find this account") ||
        pageContent.includes("couldn't find this page")
      ) {
        await store.setJSON(requestId, {
          status: "error",
          message: "프로필을 찾을 수 없습니다. URL을 확인해주세요.",
        });
      } else {
        await store.setJSON(requestId, {
          status: "error",
          message:
            "이 프로필에서 영상을 찾을 수 없습니다. 영상이 없거나 TikTok이 접근을 차단했을 수 있습니다.",
        });
      }
      return new Response("done", { status: 200 });
    }

    // Save successful result
    await store.setJSON(requestId, {
      status: "complete",
      data: {
        followerCount: result.followerCount,
        videos: result.videos,
        source: result.source,
        scrapedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    const message = err.message || String(err);

    let userMessage;
    if (message.includes("timeout") || message.includes("Timeout")) {
      userMessage =
        "TikTok 페이지 로딩 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.";
    } else if (message.includes("net::ERR_")) {
      userMessage =
        "TikTok에 접속할 수 없습니다. 네트워크 상태를 확인해주세요.";
    } else {
      userMessage = `크롤링 중 오류가 발생했습니다: ${message}`;
    }

    await store.setJSON(requestId, {
      status: "error",
      message: userMessage,
    });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  return new Response("done", { status: 200 });
};

export const config = {
  path: "/.netlify/functions/scrape-background",
};
