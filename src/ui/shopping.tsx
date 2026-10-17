import { nanoid } from "nanoid";
import { useState } from "react";
import { dispatch, useSnap } from "../data/store.tsx";
import { alive, byId } from "../domain/db.ts";
import { shoppingDone, shoppingOpen } from "../domain/select.ts";
import { useUi } from "./state.tsx";
import { ItemList } from "./tasks.tsx";
import { Button, control, Field } from "./ui.tsx";

export function ShoppingPage() {
  const { db } = useSnap();
  const ui = useUi();
  const open = shoppingOpen(db);
  const done = shoppingDone(db).slice(0, 12);
  const stores = [
    ...new Set(open.map((item) => item.store?.trim() || "Bez obchodu")),
  ];
  const templates = alive(db.shoppingTemplates);
  return (
    <div className="grid gap-6">
      <header>
        <h1 className="font-display text-3xl">Nákupy</h1>
        <p className="text-muted">Koupit teď a věci, které bereš opakovaně.</p>
      </header>
      {open.length === 0 && (
        <p className="text-sm text-muted">Nákupní seznam je prázdný.</p>
      )}
      {stores.map((store) => {
        const items = open.filter(
          (item) => (item.store?.trim() || "Bez obchodu") === store
        );
        return (
          <section key={store}>
            <h2 className="mb-1 text-sm text-muted">{store}</h2>
            <ItemList items={items} showFolder />
            {items.map((item) => (
              <Quantity
                key={item.id}
                itemId={item.id}
                quantity={item.quantity}
              />
            ))}
          </section>
        );
      })}
      <section>
        <h2 className="mb-2 font-display text-2xl">Obvykle kupuji</h2>
        <TemplateForm />
        <div className="mt-3 grid gap-2">
          {templates.map((template) => (
            <div
              key={template.id}
              className="flex items-center gap-3 rounded-md bg-raised px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate">{template.name}</p>
                <p className="text-xs text-muted">
                  {[template.store, template.defaultQuantity, template.unit]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <Button
                tone="soft"
                onClick={() => {
                  const itemId = nanoid(10);
                  const next = dispatch({
                    type: "buyTemplate",
                    templateId: template.id,
                    itemId,
                  });
                  if (!byId(next.items, itemId))
                    ui.pushToast("Tahle položka už je otevřená.");
                }}
              >
                Došla
              </Button>
              <Button
                onClick={() =>
                  dispatch({ type: "deleteTemplate", id: template.id })
                }
              >
                Smazat
              </Button>
            </div>
          ))}
        </div>
      </section>
      {done.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm text-muted">Koupené</h2>
          <ItemList items={done} showFolder />
        </section>
      )}
    </div>
  );
}

function Quantity({
  itemId,
  quantity,
}: {
  itemId: string;
  quantity: string | null;
}) {
  if (!quantity || !/^-?\d+([.,]\d+)?$/.test(quantity)) return null;
  const current = Number(quantity.replace(",", "."));
  const write = (value: number) =>
    dispatch({
      type: "updateItem",
      id: itemId,
      patch: { quantity: String(Math.max(0, value)) },
    });
  return (
    <div className="mb-2 flex items-center gap-2 pl-9 text-sm">
      <Button onClick={() => write(current - 1)}>−</Button>
      <span>{quantity}</span>
      <Button onClick={() => write(current + 1)}>+</Button>
    </div>
  );
}

function TemplateForm() {
  const [name, setName] = useState("");
  const [store, setStore] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [spec, setSpec] = useState("");
  const add = () => {
    if (!name.trim()) return;
    dispatch({
      type: "createTemplate",
      id: nanoid(10),
      name,
      store: store.trim() || null,
      unit: unit.trim() || null,
      spec: spec.trim() || null,
      defaultQuantity: quantity.trim() || null,
      folderId: null,
    });
    setName("");
    setQuantity("");
    setUnit("");
    setSpec("");
  };
  return (
    <form
      className="grid gap-2 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <Field label="Co">
        <input
          className={control}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field label="Obchod">
        <input
          className={control}
          value={store}
          onChange={(event) => setStore(event.target.value)}
        />
      </Field>
      <Field label="Množství">
        <input
          className={control}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
      </Field>
      <Field label="Jednotka">
        <input
          className={control}
          value={unit}
          onChange={(event) => setUnit(event.target.value)}
        />
      </Field>
      <div className="sm:col-span-2">
        <Button tone="solid" type="submit">
          Uložit do obvyklých
        </Button>
      </div>
    </form>
  );
}
