export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const { profileUrl } = body;

  // Extract profile URL from any TikTok link
  const profileMatch = (profileUrl || "").match(
    /^(https?:\/\/(www\.)?tiktok\.com\/@[\w.]+)/
  );
  if (!profileMatch) {
    return jsonResponse({
      status: "error",
      message:
        "올바른 TikTok URL을 입력해주세요 (예: https://www.tiktok.com/@username 또는 영상 링크)",
    });
  }

  const finalUrl = profileMatch[1];

  try {
    // Fetch TikTok profile page HTML
    const res = await fetch(finalUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      if (res.status === 404) {
        return jsonResponse({
          status: "error",
          message: "프로필을 찾을 수 없습니다. URL을 확인해주세요.",
        });
      }
      return jsonResponse({
        status: "error",
        message: `TikTok 서버 오류 (${res.status}). 잠시 후 다시 시도해주세요.`,
      });
    }

    const html = await res.text();

    // Extract embedded JSON
    const jsonMatch = html.match(
      /<script\s+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/
    );

    if (!jsonMatch) {
      // Check if profile doesn't exist
      if (
        html.includes("Couldn't find this account") ||
        html.includes("couldn't find this page") ||
        html.includes("사용할 수 없는 페이지")
      ) {
        return jsonResponse({
          status: "error",
          message: "프로필을 찾을 수 없습니다. URL을 확인해주세요.",
        });
      }

      return jsonResponse({
        status: "error",
        message:
          "TikTok 페이지에서 데이터를 추출할 수 없습니다. TikTok이 접근을 차단했을 수 있습니다. 잠시 후 다시 시도해주세요.",
      });
    }

    let jsonData;
    try {
      jsonData = JSON.parse(jsonMatch[1]);
    } catch {
      return jsonResponse({
        status: "error",
        message: "TikTok 데이터 파싱에 실패했습니다. 잠시 후 다시 시도해주세요.",
      });
    }

    const scope = jsonData?.["__DEFAULT_SCOPE__"];
    const userDetail = scope?.["webapp.user-detail"];

    if (!userDetail || userDetail.statusCode === 10221) {
      return jsonResponse({
        status: "error",
        message: "프로필을 찾을 수 없습니다. URL을 확인해주세요.",
      });
    }

    // Extract user info
    const userInfo = userDetail?.userInfo;
    const userStats = userInfo?.stats;
    const followerCount = userStats?.followerCount ?? "N/A";

    // Extract video list
    const itemList = userDetail?.itemList || [];

    if (itemList.length === 0) {
      // Maybe TikTok didn't include video list in SSR data
      // Try SIGI_STATE as alternative
      const sigiMatch = html.match(
        /<script\s+id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/
      );

      if (sigiMatch) {
        try {
          const sigiData = JSON.parse(sigiMatch[1]);
          const itemModule = sigiData?.ItemModule || {};
          const videos = Object.values(itemModule)
            .slice(0, 7)
            .map((item) => ({
              id: item.id || "",
              desc: item.desc || "",
              playCount: item.stats?.playCount ?? 0,
              createTime: item.createTime ? Number(item.createTime) : null,
            }));

          if (videos.length > 0) {
            return jsonResponse({
              status: "complete",
              data: {
                followerCount,
                videos,
                scrapedAt: new Date().toISOString(),
              },
            });
          }
        } catch {
          // ignore
        }
      }

      return jsonResponse({
        status: "error",
        message:
          "이 프로필에서 영상을 찾을 수 없습니다. 영상이 없거나 비공개 계정일 수 있습니다.",
      });
    }

    const videos = itemList.slice(0, 7).map((item) => ({
      id: item.id || "",
      desc: item.desc || "",
      playCount: item.stats?.playCount ?? 0,
      createTime: item.createTime ? Number(item.createTime) : null,
    }));

    return jsonResponse({
      status: "complete",
      data: {
        followerCount,
        videos,
        scrapedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    const message = err.message || String(err);

    if (message.includes("timeout") || message.includes("Timeout")) {
      return jsonResponse({
        status: "error",
        message:
          "TikTok 서버 응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.",
      });
    }

    return jsonResponse({
      status: "error",
      message: `크롤링 중 오류가 발생했습니다: ${message}`,
    });
  }
};

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
