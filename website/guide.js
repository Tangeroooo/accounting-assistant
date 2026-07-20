const checklistKey = "barun-guide-checklist-v1";
const checkboxes = [...document.querySelectorAll("[data-guide-check]")];
const progressValue = document.querySelector("[data-progress-value]");
const progressBar = document.querySelector("[data-progress-bar]");
const progressCount = document.querySelector("[data-progress-count]");
const progressTotal = document.querySelector("[data-progress-total]");

const readChecklist = () => {
  try {
    return JSON.parse(localStorage.getItem(checklistKey) || "{}") ?? {};
  } catch {
    return {};
  }
};

const renderProgress = () => {
  const checked = checkboxes.filter((checkbox) => checkbox.checked).length;
  const total = checkboxes.length;
  const percent = total ? Math.round(checked / total * 100) : 0;
  if (progressValue) progressValue.textContent = String(percent);
  if (progressBar) progressBar.style.width = `${percent}%`;
  if (progressCount) progressCount.textContent = String(checked);
  if (progressTotal) progressTotal.textContent = String(total);
};

const storedChecklist = readChecklist();
checkboxes.forEach((checkbox) => {
  checkbox.checked = Boolean(storedChecklist[checkbox.dataset.guideCheck]);
  checkbox.addEventListener("change", () => {
    const next = readChecklist();
    next[checkbox.dataset.guideCheck] = checkbox.checked;
    localStorage.setItem(checklistKey, JSON.stringify(next));
    renderProgress();
  });
});

document.querySelector("[data-reset-checklist]")?.addEventListener("click", () => {
  if (!window.confirm("가이드의 모든 체크 표시를 지울까요?")) return;
  localStorage.removeItem(checklistKey);
  checkboxes.forEach((checkbox) => { checkbox.checked = false; });
  renderProgress();
});

const guideSections = [...document.querySelectorAll(".guide-step[id], .guide-reference[id]")];
const tocLinks = [...document.querySelectorAll(".guide-toc a[href^='#']")];
const observer = new IntersectionObserver((entries) => {
  const visible = entries
    .filter((entry) => entry.isIntersecting)
    .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
  if (!visible) return;
  tocLinks.forEach((link) => link.classList.toggle("active", link.getAttribute("href") === `#${visible.target.id}`));
}, { rootMargin: "-18% 0px -68%", threshold: [0, 0.2, 0.5] });
guideSections.forEach((section) => observer.observe(section));

renderProgress();
