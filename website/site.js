const repository = "Tangeroooo/accounting-assistant";
const latestReleasePage = `https://github.com/${repository}/releases/latest`;

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const megabytes = bytes / 1024 / 1024;
  return `${megabytes >= 10 ? Math.round(megabytes) : megabytes.toFixed(1)} MB`;
};

const findAsset = (assets, platform) => assets.find((asset) => {
  const name = asset.name.toLowerCase();
  if (platform === "mac-arm") return name.endsWith(".dmg") && /(aarch64|arm64|apple-silicon)/.test(name);
  if (platform === "mac-intel") return name.endsWith(".dmg") && /(x86_64|x64|intel)/.test(name);
  if (platform === "windows") return name.endsWith(".exe") && /(setup|windows|x64|amd64)/.test(name);
  return false;
});

const applyRelease = (release) => {
  const version = release.tag_name || `v${release.name || "0.1.0"}`;
  const publishedDate = release.published_at
    ? new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric" }).format(new Date(release.published_at))
    : "";
  document.querySelectorAll("[data-release-version]").forEach((node) => { node.textContent = `${version} 최신 버전`; });
  document.querySelectorAll("[data-release-date]").forEach((node) => { node.textContent = publishedDate; });
  document.querySelector(".release-status")?.classList.add("ready");

  ["mac-arm", "mac-intel", "windows"].forEach((platform) => {
    const asset = findAsset(release.assets || [], platform);
    const link = document.querySelector(`[data-download="${platform}"]`);
    const note = document.querySelector(`[data-asset-note="${platform}"]`);
    if (link) link.href = asset?.browser_download_url || release.html_url || latestReleasePage;
    if (note && asset) note.textContent = `${platform === "windows" ? "EXE 설치 프로그램 · 언인스톨러 포함" : "DMG 설치 이미지"} · ${formatBytes(asset.size)}`;
  });
};

fetch(`https://api.github.com/repos/${repository}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } })
  .then((response) => {
    if (!response.ok) throw new Error("release unavailable");
    return response.json();
  })
  .then(applyRelease)
  .catch(() => {
    const version = document.querySelector("[data-release-version]");
    const date = document.querySelector("[data-release-date]");
    if (version) version.textContent = "첫 공개 릴리스 준비 중";
    if (date) date.textContent = "GitHub Releases에서 확인";
  });

const dialog = document.querySelector("#screenshot-dialog");
const dialogImage = dialog?.querySelector("img");
document.querySelectorAll(".screenshot-card").forEach((button) => {
  button.addEventListener("click", () => {
    if (!dialog || !dialogImage) return;
    dialogImage.src = button.dataset.image || "";
    dialogImage.alt = button.dataset.alt || "앱 화면 크게 보기";
    dialog.showModal();
  });
});
dialog?.querySelector(".dialog-close")?.addEventListener("click", () => dialog.close());
dialog?.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
