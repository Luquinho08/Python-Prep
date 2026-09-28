import Form from "next/form";

export function SearchBox({ defaultValue = "" }: { defaultValue?: string }) {
  return (
    <Form action="/productos" role="search" className="flex w-full">
      <label htmlFor="q-header" className="sr-only">
        Buscar productos
      </label>
      <input
        id="q-header"
        name="q"
        type="search"
        defaultValue={defaultValue}
        placeholder="Buscá etiquetas, invitaciones, temáticas…"
        className="min-h-11 w-full rounded-l-full border-2 border-r-0 border-line bg-surface-soft px-4 text-base focus:border-blue-strong focus:bg-white focus:outline-none"
        maxLength={80}
        autoComplete="off"
      />
      <button type="submit" className="min-h-11 rounded-r-full bg-brand-blue px-4 text-sm font-semibold text-ink hover:bg-[#5c99d3]">
        Buscar
      </button>
    </Form>
  );
}
