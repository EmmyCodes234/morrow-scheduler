import { getBookingForCancellation } from "@/lib/scheduling/cancellation-service";
import { GuestCancellationView } from "@/components/scheduling/guest-cancellation-view";

export const instant = false;

export const metadata = {
  title: "Cancel Booking | Morrow",
  description: "Cancel your scheduled appointment on Morrow",
};

export default async function GuestCancellationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const booking = await getBookingForCancellation(token);

  return (
    <main className="min-h-screen bg-background-full flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <GuestCancellationView token={token} initialBooking={booking} />
    </main>
  );
}
