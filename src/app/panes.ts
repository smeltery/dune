/** Which of the sidebar's views is on screen: the file tree, the git panel,
 * the review panel or the plugins panel. */
export type SidebarView = 'files' | 'git' | 'review' | 'plugins';

/** Shift+Tab's order through the tab strip. */
const ORDER: SidebarView[] = ['files', 'git', 'review', 'plugins'];

/** The view Shift+Tab lands on next, wrapping from the last tab to the first. */
export function nextSidebarView(current: SidebarView): SidebarView {
	return ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]!;
}
