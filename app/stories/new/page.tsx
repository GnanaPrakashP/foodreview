import { notFound } from "next/navigation";

// Stories feature removed for MVP. Route kept as an explicit 404.
export default function NewStoryPage() {
  return notFound();
}
