import { cn } from "~/lib/utils";

export function MaterialSymbol(props: {
  name: string;
  className?: string;
}) {
  const { name, className } = props;

  return (
    <span aria-hidden="true" className={cn("material-symbols-outlined", className)}>
      {name}
    </span>
  );
}
