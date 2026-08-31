// Standalone toast utility — no React context needed
// Works by directly manipulating the DOM, survives re-renders

type ToastType = "success" | "info" | "warning";

let toastContainer: HTMLDivElement | null = null;
let toastId = 0;

function getContainer(): HTMLDivElement {
  if (!toastContainer || !document.body.contains(toastContainer)) {
    toastContainer = document.createElement("div");
    toastContainer.className = "toast-container";
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

export function showToast(message: string, type: ToastType = "success") {
  console.log("[showToast] called:", message, type);
  const container = getContainer();
  const id = ++toastId;

  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.id = `toast-${id}`;
  el.textContent = message;
  container.appendChild(el);
  console.log("[showToast] element added, container children:", container.children.length);

  // Trigger animation
  requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "translateX(0)";
  });

  // Auto-remove after 3s
  setTimeout(() => {
    const toast = document.getElementById(`toast-${id}`);
    if (toast) {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(100%)";
      setTimeout(() => toast.remove(), 300);
    }
  }, 3000);
}
