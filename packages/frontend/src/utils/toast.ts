// Standalone toast utility — no React context needed
// Works by directly manipulating the DOM, survives re-renders

type ToastType = "success" | "info" | "warning";

let toastContainer: HTMLDivElement | null = null;

function getContainer(): HTMLDivElement {
  if (!toastContainer || !document.body.contains(toastContainer)) {
    toastContainer = document.createElement("div");
    toastContainer.className = "toast-container";
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

export function showToast(message: string, type: ToastType = "success") {
  const container = getContainer();

  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);

  // Trigger animation
  requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "translateX(0)";
  });

  // Auto-remove after 3s. Animate the element directly (not by id lookup) so
  // removal still works if the container was recreated meanwhile.
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateX(100%)";
    setTimeout(() => el.remove(), 300);
  }, 3000);
}
