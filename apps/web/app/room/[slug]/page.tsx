import { TableRoom } from "../../../components/TableRoom";

export default async function RoomPage({
    params,
    searchParams,
}: {
    params: Promise<{ slug: string }>;
    searchParams: Promise<{ host?: string }>;
}) {
    const { slug } = await params;
    const query = await searchParams;
    return <TableRoom slug={slug} hostKeyFromUrl={query.host ?? null} />;
}
