/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createRoot, getOwner, runWithOwner } from "solid-js";
import {
  isFloating,
  panelSidebarConfig,
  selectedPanelId,
  setIsFloatingDragging,
  setPanelSidebarConfig,
  setSelectedPanelId,
} from "../data/data.ts";
import { STATIC_PANEL_DATA } from "../data/static-panels.ts";
import { isResizeCooldown } from "./floating-splitter.tsx";
import type { Panel } from "../utils/type.ts";

declare global {
  interface Window {
    gFloorpPanelSidebar?: {
      getPanelData: (id: string) => Panel | undefined;
      showPanel: (panel: Panel) => void;
    };
  }
}

const { AppConstants } = ChromeUtils.importESModule(
  "resource://gre/modules/AppConstants.sys.mjs",
);

export class PanelSidebarFloating {
  private static instance: PanelSidebarFloating;
  public static getInstance() {
    if (!PanelSidebarFloating.instance) {
      PanelSidebarFloating.instance = new PanelSidebarFloating();
    }
    return PanelSidebarFloating.instance;
  }

  private resizeObserver: ResizeObserver | null = null;
  private parentHeightTargetId = "browser";
  private userResizedHeight = false;
  private isDraggingHeader = false;
  private autoCloseTimer: number | null = null;

  constructor() {
    const owner = getOwner();
    const exec1 = () => {
      createEffect(() => {
        if (isFloating()) {
          if (!this.userResizedHeight) {
            this.applyHeightToSidebarBox();
          }
          this.initResizeObserver();
          // Removed initDragHeader() - panels are docked to sidebar like Vivaldi
          this.applyDockedPositionToSidebarBox();
          this.initAutoCloseListeners();
          document?.addEventListener(
            "mousedown",
            this.handleOutsideClick,
            true,
          );
        } else {
          this.removeFloatingStyles();
          this.resizeObserver?.disconnect();
          document?.removeEventListener(
            "mousedown",
            this.handleOutsideClick,
            true,
          );
          this.removeAutoCloseListeners();
          this.userResizedHeight = false;
          this.restoreActivePanel();
        }
      });
    };

    const exec2 = () => {
      createEffect(() => {
        const position = panelSidebarConfig().position_start;
        if (position) {
          document
            ?.getElementById("panel-sidebar-box")
            ?.setAttribute("data-floating-splitter-side", "start");
        } else {
          document
            ?.getElementById("panel-sidebar-box")
            ?.setAttribute("data-floating-splitter-side", "end");
        }
      });
    };

    if (owner) {
      runWithOwner(owner, exec1);
      runWithOwner(owner, exec2);
    } else {
      createRoot(exec1);
      createRoot(exec2);
    }
  }

  private initResizeObserver() {
    const tabbrowserTabboxElem = document?.getElementById(
      this.parentHeightTargetId,
    );
    const sidebarBox = document?.getElementById("panel-sidebar-box");

    if (!tabbrowserTabboxElem || !sidebarBox) {
      return;
    }

    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (
          entry.target.id === this.parentHeightTargetId &&
          isFloating() &&
          !this.userResizedHeight
        ) {
          this.applyHeightToSidebarBox();
        }
      }
    });

    this.resizeObserver.observe(tabbrowserTabboxElem);

    sidebarBox.addEventListener("mousedown", (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const isResizer = target.classList.contains("floating-splitter-side") ||
        target.classList.contains("floating-splitter-vertical") ||
        target.classList.contains("floating-splitter-corner");

      if (isResizer) {
        this.userResizedHeight = true;

        const onMouseUp = () => {
          this.saveCurrentSidebarSize();
          document?.removeEventListener("mouseup", onMouseUp);
        };

        document?.addEventListener("mouseup", onMouseUp);
      }
    });
  }

  // Removed initDragHeader() - panels are docked to sidebar like Vivaldi

  private initAutoCloseListeners() {
    if (!panelSidebarConfig().autoCloseFloating) {
      return;
    }

    const sidebarBox = document?.getElementById("panel-sidebar-box");
    const selectBox = document?.getElementById("panel-sidebar-select-box");

    if (!sidebarBox) {
      return;
    }

    const handleMouseEnter = () => {
      this.clearAutoCloseTimer();
    };

    const handleMouseLeave = (e: MouseEvent) => {
      // Only close if mouse is actually leaving the panel area
      if (!this.isMouseInPanelArea(e)) {
        this.startAutoCloseTimer();
      }
    };

    sidebarBox.addEventListener("mouseenter", handleMouseEnter);
    sidebarBox.addEventListener("mouseleave", handleMouseLeave);

    if (selectBox) {
      selectBox.addEventListener("mouseenter", handleMouseEnter);
      selectBox.addEventListener("mouseleave", handleMouseLeave);
    }
  }

  private removeAutoCloseListeners() {
    this.clearAutoCloseTimer();
    // Event listeners are automatically cleaned up when elements are removed
  }

  private startAutoCloseTimer() {
    if (this.autoCloseTimer !== null) {
      return;
    }

    this.autoCloseTimer = window.setTimeout(() => {
      setSelectedPanelId(null);
      this.autoCloseTimer = null;
    }, 500); // 500ms delay like Vivaldi
  }

  private clearAutoCloseTimer() {
    if (this.autoCloseTimer !== null) {
      window.clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }
  }

  private isMouseInPanelArea(e: MouseEvent): boolean {
    const sidebarBox = document?.getElementById("panel-sidebar-box");
    const selectBox = document?.getElementById("panel-sidebar-select-box");

    return !!(
      sidebarBox?.contains(e.target as Node) ||
      selectBox?.contains(e.target as Node)
    );
  }

  private applyDockedPositionToSidebarBox() {
    const sidebarBox = document?.getElementById(
      "panel-sidebar-box",
    ) as XULElement;

    if (!sidebarBox) {
      return;
    }

    // Dock to sidebar edge like Vivaldi - no free positioning
    const config = panelSidebarConfig();
    sidebarBox.style.setProperty("margin", "0");
    sidebarBox.style.setProperty("position", "absolute");
    sidebarBox.style.removeProperty("right");
    sidebarBox.style.removeProperty("left");

    // Apply stored width/height if available
    if (
      config.floatingWidth !== undefined &&
      config.floatingHeight !== undefined
    ) {
      sidebarBox.style.setProperty("width", `${config.floatingWidth}px`);
      sidebarBox.style.setProperty("height", `${config.floatingHeight}px`);
      this.userResizedHeight = true;
    }
  }

  private savePosition() {
    const sidebarBox = document?.getElementById(
      "panel-sidebar-box",
    ) as XULElement;
    if (!sidebarBox) {
      return;
    }

    const left = Number.parseInt(
      sidebarBox.style.getPropertyValue("left") || "0",
      10,
    );
    const top = Number.parseInt(
      sidebarBox.style.getPropertyValue("top") || "0",
      10,
    );

    const config = panelSidebarConfig();
    setPanelSidebarConfig({
      ...config,
      floatingPositionLeft: left,
      floatingPositionTop: top,
    });
  }

  private applyHeightToSidebarBox() {
    const el = document?.getElementById("panel-sidebar-box") as
      | XULElement
      | null;
    if (el) {
      el.style.height = `${this.getBrowserHeight() - 20}px`;
    }
  }

  private removeFloatingStyles() {
    const sidebarBox = document?.getElementById(
      "panel-sidebar-box",
    ) as XULElement;
    if (!sidebarBox) {
      return;
    }

    sidebarBox.style.removeProperty("height");
    sidebarBox.style.removeProperty("width");
    sidebarBox.style.removeProperty("position");
    sidebarBox.style.removeProperty("left");
    sidebarBox.style.removeProperty("right");
    sidebarBox.style.removeProperty("top");
    sidebarBox.style.removeProperty("margin");

    sidebarBox.style.setProperty("min-width", "225px");
  }

  private removeHeightToSidebarBox() {
    const el = document?.getElementById("panel-sidebar-box") as
      | XULElement
      | null;
    if (el) {
      el.style.height = "";
    }
  }

  private getBrowserHeight() {
    return (
      document?.getElementById(this.parentHeightTargetId)?.clientHeight ?? 0
    );
  }

  private saveCurrentSidebarSize() {
    const sidebarBox = document?.getElementById(
      "panel-sidebar-box",
    ) as XULElement;
    if (!sidebarBox) return;

    const config = panelSidebarConfig();

    const width = sidebarBox.getBoundingClientRect().width;
    const height = sidebarBox.getBoundingClientRect().height;

    setPanelSidebarConfig({
      ...config,
      floatingWidth: width,
      floatingHeight: height,
    });
  }

  // Replaced with applyDockedPositionToSidebarBox() for Vivaldi-style docking

  private handleOutsideClick = (event: MouseEvent) => {
    if (!isFloating()) {
      return;
    }

    if (isResizeCooldown() || this.isDraggingHeader) {
      return;
    }

    const sidebarBox = document?.getElementById("panel-sidebar-box");
    const selectBox = document?.getElementById("panel-sidebar-select-box");
    const splitter = document?.getElementById("panel-sidebar-splitter");
    const browsers = sidebarBox?.querySelectorAll(".sidebar-panel-browser");

    const clickedBrowser = (event.target as XULElement).ownerDocument
      ?.activeElement;
    const clickedBrowserIsSidebarBrowser = Array.from(browsers ?? []).some(
      (browser) => browser === clickedBrowser,
    );
    const clickedElementIsChromeSidebar = Object.values(STATIC_PANEL_DATA).some(
      (panel) =>
        panel.url === (clickedBrowser as XULElement).ownerDocument?.documentURI,
    );
    const clickedElementIsWebTypeBrowser = clickedBrowser?.baseURI?.startsWith(
      `${AppConstants.BROWSER_CHROME_URL}?floorpWebPanelId`,
    );
    const insideSidebar = sidebarBox?.contains(event.target as Node) ||
      clickedBrowserIsSidebarBrowser;
    const insideSelectBox = selectBox?.contains(event.target as Node);
    const insideSplitter = splitter?.contains(event.target as Node);

    if (
      !insideSidebar &&
      !insideSelectBox &&
      !insideSplitter &&
      !clickedElementIsChromeSidebar &&
      !clickedElementIsWebTypeBrowser
    ) {
      setSelectedPanelId(null);
    }
  };

  private restoreActivePanel() {
    const currentPanelId = selectedPanelId();

    if (currentPanelId) {
      try {
        const panelSidebarInstance = window.gFloorpPanelSidebar;
        if (panelSidebarInstance) {
          setSelectedPanelId(null);

          setTimeout(() => {
            setSelectedPanelId(currentPanelId);
            if (panelSidebarInstance.showPanel) {
              const panel = panelSidebarInstance.getPanelData(currentPanelId);
              if (panel) {
                panelSidebarInstance.showPanel(panel);
              }
            }
          }, 50);
        }
      } catch (e) {
        console.error("Failed to restore panel:", e);
      }
    }
  }
}
