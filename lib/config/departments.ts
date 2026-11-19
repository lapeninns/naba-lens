/** Team membership is separate from application access roles. */
export type Department = "foh" | "boh"

export const DEPARTMENT_OPTIONS = [
  { id: "foh", name: "Front of house (FOH)" },
  { id: "boh", name: "Back of house (BOH)" },
] satisfies { id: Department; name: string }[]

export function isDepartment(value: unknown): value is Department {
  return value === "foh" || value === "boh"
}

export function departmentLabel(
  department: Department | null | undefined
): string | null {
  return (
    DEPARTMENT_OPTIONS.find((option) => option.id === department)?.name ?? null
  )
}
