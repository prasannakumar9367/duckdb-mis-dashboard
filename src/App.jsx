import { NotebookProvider } from "./context/NotebookContext";
import Notebook from "./pages/Notebook";

export default function App() {
  return (
    <NotebookProvider>
      <Notebook />
    </NotebookProvider>
  );
}