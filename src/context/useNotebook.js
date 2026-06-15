import { useContext } from "react";
import { NotebookContext } from "./NotebookContext";

export function useNotebook() {
  return useContext(NotebookContext);
}
