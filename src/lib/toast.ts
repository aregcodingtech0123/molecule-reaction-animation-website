import { toast as sonner } from "sonner";

export const toast = {
  success(message: string) {
    sonner.success(message);
  },
  error(message: string) {
    sonner.error(message);
  },
  info(message: string) {
    sonner.info(message);
  },
  loading(message: string) {
    return sonner.loading(message);
  },
  dismiss(id?: string | number) {
    sonner.dismiss(id);
  },
};
