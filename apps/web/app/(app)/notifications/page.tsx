import type { Metadata } from "next";
import { AutoRefresh } from "@/components/devices/auto-refresh";
import { NotificationList } from "@/components/notifications/notification-list";
import { PageHeader } from "@/components/shell/page-header";
import { parseNotificationsLimit } from "@/lib/notifications/notifications";
import { loadNotifications, loadUnreadCount } from "@/lib/notifications/queries";

export const metadata: Metadata = { title: "Notifications" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const limit = parseNotificationsLimit(await searchParams);
  const [page, unread] = await Promise.all([loadNotifications(limit), loadUnreadCount()]);
  return (
    <>
      <PageHeader title="Notifications" description="Alerts about your family's devices." />
      <AutoRefresh />
      <NotificationList page={page} unread={unread} limit={limit} />
    </>
  );
}
