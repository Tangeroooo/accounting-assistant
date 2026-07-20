import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { AlertCircle, BadgeCheck, Download, LoaderCircle, RefreshCw, Rocket, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { isTauri } from "../lib/desktop";

type UpdateStage = "idle" | "checking" | "available" | "current" | "downloading" | "restarting" | "error";

interface AppUpdaterProps {
  beforeInstall?: () => Promise<void>;
}

function friendlyUpdateError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/signature|public key|private key|verify/i.test(message)) return "업데이트 서명을 확인하지 못해 안전을 위해 설치를 중단했습니다.";
  if (/404|not found/i.test(message)) return "아직 GitHub에 공개된 업데이트가 없습니다.";
  if (/network|fetch|connect|dns|timed? ?out|offline/i.test(message)) return "인터넷 연결을 확인한 뒤 다시 시도해 주세요.";
  if (/cancel|취소/i.test(message)) return "프로젝트 저장이 취소되어 업데이트도 시작하지 않았습니다.";
  return "업데이트 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

export default function AppUpdater({ beforeInstall }: AppUpdaterProps) {
  const [stage, setStage] = useState<UpdateStage>("idle");
  const [opened, setOpened] = useState(false);
  const [currentVersion, setCurrentVersion] = useState("0.1.0");
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState<number | undefined>();
  const updateRef = useRef<Update | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    void getVersion().then(setCurrentVersion).catch(() => undefined);
  }, []);

  const checkForUpdate = useCallback(async (manual: boolean) => {
    if (!isTauri()) {
      if (manual) {
        setErrorMessage("설치형 앱에서만 업데이트를 확인할 수 있습니다.");
        setStage("error");
        setOpened(true);
      }
      return;
    }

    if (manual) setOpened(true);
    setStage("checking");
    setErrorMessage("");
    try {
      if (updateRef.current) {
        await updateRef.current.close().catch(() => undefined);
        updateRef.current = null;
      }
      const update = await check({ timeout: 15_000 });
      if (!update) {
        setAvailableUpdate(null);
        setStage("current");
        if (!manual) setOpened(false);
        return;
      }
      updateRef.current = update;
      setAvailableUpdate(update);
      setStage("available");
      setOpened(true);
    } catch (error) {
      setStage(manual ? "error" : "idle");
      setErrorMessage(friendlyUpdateError(error));
      if (!manual) setOpened(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void checkForUpdate(false), 2_500);
    return () => window.clearTimeout(timer);
  }, [checkForUpdate]);

  useEffect(() => () => {
    if (updateRef.current) void updateRef.current.close().catch(() => undefined);
  }, []);

  const installUpdate = async () => {
    if (!availableUpdate) return;
    setStage("downloading");
    setDownloadedBytes(0);
    setTotalBytes(undefined);
    try {
      await beforeInstall?.();
      let downloaded = 0;
      await availableUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") {
          setTotalBytes(event.data.contentLength);
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setDownloadedBytes(downloaded);
        }
      }, { timeout: 120_000 });
      setStage("restarting");
      await relaunch();
    } catch (error) {
      setErrorMessage(friendlyUpdateError(error));
      setStage("error");
    }
  };

  const progress = totalBytes ? Math.min(100, Math.round(downloadedBytes / totalBytes * 100)) : undefined;
  const close = () => {
    if (stage === "downloading" || stage === "restarting") return;
    setOpened(false);
  };

  return (
    <>
      <button
        className={`icon-button update-check-button ${stage === "available" ? "available" : ""}`}
        onClick={() => void checkForUpdate(true)}
        disabled={stage === "checking" || stage === "downloading" || stage === "restarting"}
        aria-label="업데이트 확인"
        title="업데이트 확인"
      >
        {stage === "checking" ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}
        {stage === "available" && <span aria-hidden="true" />}
      </button>

      {opened && (
        <div className="update-modal-backdrop no-print" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
          <section className="update-modal" role="dialog" aria-modal="true" aria-labelledby="update-modal-title">
            <button className="icon-button update-modal-close" onClick={close} disabled={stage === "downloading" || stage === "restarting"} aria-label="업데이트 창 닫기"><X size={18} /></button>

            <div className={`update-hero-icon ${stage}`}>
              {stage === "checking" || stage === "downloading" || stage === "restarting"
                ? <LoaderCircle className="spin" size={30} />
                : stage === "available"
                  ? <Rocket size={30} />
                  : stage === "current"
                    ? <BadgeCheck size={30} />
                    : stage === "error"
                      ? <AlertCircle size={30} />
                      : <RefreshCw size={30} />}
            </div>

            <span className="eyebrow">APP UPDATE</span>
            <h2 id="update-modal-title">
              {stage === "checking" && "새 버전을 확인하고 있어요"}
              {stage === "available" && `${availableUpdate?.version} 업데이트가 있습니다`}
              {stage === "current" && "최신 버전을 사용 중입니다"}
              {stage === "downloading" && "업데이트를 설치하고 있어요"}
              {stage === "restarting" && "설치 완료, 앱을 다시 시작합니다"}
              {stage === "error" && "업데이트를 확인하지 못했습니다"}
              {stage === "idle" && "업데이트 확인"}
            </h2>

            <p className="update-description">
              {stage === "available" && `현재 ${availableUpdate?.currentVersion ?? currentVersion} → 새 버전 ${availableUpdate?.version}`}
              {stage === "current" && `현재 버전 ${currentVersion}`}
              {stage === "checking" && "GitHub Releases에서 안전하게 서명된 업데이트를 찾고 있습니다."}
              {stage === "downloading" && "이미지를 포함한 .barun 프로젝트와 업데이트 전 복구 사본을 저장한 뒤 새 버전을 설치합니다. 앱을 종료하지 마세요."}
              {stage === "restarting" && "잠시 후 새 버전으로 다시 열립니다."}
              {stage === "error" && errorMessage}
            </p>

            {stage === "available" && availableUpdate?.body && (
              <div className="update-release-notes"><strong>이번 버전 변경사항</strong><p>{availableUpdate.body}</p></div>
            )}

            {stage === "downloading" && (
              <div className="update-progress">
                <div><i style={{ width: `${progress ?? 18}%` }} className={progress === undefined ? "indeterminate" : ""} /></div>
                <span>{progress === undefined ? "다운로드 준비 중" : `${progress}%`}</span>
              </div>
            )}

            <div className="update-actions">
              {stage === "available" && <button className="button accent" onClick={() => void installUpdate()}><Download size={17} /> 저장 후 업데이트</button>}
              {(stage === "current" || stage === "error") && <button className="button primary" onClick={() => void checkForUpdate(true)}><RefreshCw size={17} /> 다시 확인</button>}
              {(stage === "current" || stage === "error" || stage === "available") && <button className="button ghost" onClick={close}>{stage === "available" ? "나중에" : "닫기"}</button>}
            </div>
            <small className="update-security-note">업데이트 파일은 앱에 내장된 공개키로 서명을 확인한 뒤에만 설치됩니다.</small>
          </section>
        </div>
      )}
    </>
  );
}
