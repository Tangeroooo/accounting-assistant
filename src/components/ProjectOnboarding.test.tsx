// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createEmptyProject } from "../types";
import ProjectOnboarding from "./ProjectOnboarding";

describe("프로젝트 시작 저장 위치 단계", () => {
  it("저장 위치 선택 전후에 해야 할 행동과 선택 경로를 명확히 보여준다", async () => {
    const project = createEmptyProject();
    project.meta.community = "여호수아";
    project.meta.teamName = "강릉팀";
    const onChooseDirectory = vi.fn(async () => true);
    const commonProps = {
      project,
      requiresDirectory: true,
      updateProject: vi.fn(),
      onChooseDirectory,
      onFinish: vi.fn(),
      onOpen: vi.fn(),
    };
    const { rerender } = render(<ProjectOnboarding {...commonProps} />);

    expect(screen.getByRole("button", { name: /기존 \.barun 프로젝트 열기/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /다음/ }));
    fireEvent.click(screen.getByRole("button", { name: /다음/ }));

    expect(screen.getByRole("heading", { name: "프로젝트 파일을 어디에 저장할까요?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /저장 위치 선택/ })).toBeTruthy();
    expect((screen.getByRole("button", { name: /저장 위치를 먼저 선택하세요/ }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /^저장 위치 선택$/ }));
    await waitFor(() => expect(onChooseDirectory).toHaveBeenCalledTimes(1));

    rerender(<ProjectOnboarding {...commonProps} projectFilePath="/Users/juhyeon/Documents/강릉팀 회계.barun" />);
    expect(screen.getByText("/Users/juhyeon/Documents/강릉팀 회계.barun")).toBeTruthy();
    expect(screen.getByRole("button", { name: /저장 위치 변경/ })).toBeTruthy();
    expect((screen.getByRole("button", { name: /회계 입력 시작/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});
