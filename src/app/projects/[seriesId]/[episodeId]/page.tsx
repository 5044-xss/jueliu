import { redirect } from "next/navigation";

export default async function EpisodeIndexPage({
  params,
}: {
  params: Promise<{ seriesId: string; episodeId: string }>;
}) {
  const { seriesId, episodeId } = await params;
  redirect(`/projects/${seriesId}/${episodeId}/story`);
}
