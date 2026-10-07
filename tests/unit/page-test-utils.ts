import {
  isValidElement,
  Suspense,
  type ReactNode,
  type SuspenseProps,
} from "react";

export async function resolvePageContent(page: unknown) {
  if (!isValidElement<SuspenseProps>(page) || page.type !== Suspense) {
    throw new Error("Expected a synchronous page-local Suspense boundary");
  }

  const content = page.props.children;
  if (
    !isValidElement<Record<string, unknown>>(content) ||
    typeof content.type !== "function"
  ) {
    throw new Error("Expected a server content component below Suspense");
  }

  const renderContent = content.type as (
    props: Record<string, unknown>,
  ) => ReactNode | Promise<ReactNode>;
  const result = await renderContent(content.props);
  if (!isValidElement<Record<string, unknown>>(result)) {
    throw new Error("Expected the page content to return an element");
  }
  return result;
}
