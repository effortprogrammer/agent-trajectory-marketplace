import { createFileRoute } from "@tanstack/react-router";
import { CustomTemplate } from "@/layouts/custom";

interface AppSearch {
  preview: boolean;
}

export const Route = createFileRoute("/app")({
  validateSearch: (search: Record<string, unknown>): AppSearch => ({
    preview: search.preview === "1" || search.preview === true,
  }),
  component: AppRoute,
});

function AppRoute() {
  const { preview } = Route.useSearch();
  return <CustomTemplate previewMode={preview} />;
}
