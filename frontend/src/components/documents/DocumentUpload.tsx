"use client";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, X, FileText, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { documentsApi, Document } from "@/lib/api";
import clsx from "clsx";

interface UploadResult {
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  document?: Document;
  error?: string;
}

interface DocumentUploadProps {
  productId?: number;
  scope?: "generique" | "produit";
  onSuccess?: (doc: Document) => void;
}

const ACCEPTED = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.ms-excel": [".xls"],
  "text/plain": [".txt"],
};

export function DocumentUpload({ productId, scope = "produit", onSuccess }: DocumentUploadProps) {
  const [results, setResults] = useState<UploadResult[]>([]);

  const uploadFile = useCallback(async (file: File, index: number) => {
    setResults((prev) => prev.map((r, i) => i === index ? { ...r, status: "uploading" } : r));
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("scope", scope);
      if (productId) fd.append("product_id", String(productId));
      const { data } = await documentsApi.upload(fd);
      setResults((prev) => prev.map((r, i) => i === index ? { ...r, status: "done", document: data } : r));
      onSuccess?.(data);
    } catch (err: any) {
      const msg = err.response?.data?.detail || err.message || "Erreur upload";
      setResults((prev) => prev.map((r, i) => i === index ? { ...r, status: "error", error: msg } : r));
    }
  }, [productId, scope, onSuccess]);

  const onDrop = useCallback((accepted: File[]) => {
    const newItems: UploadResult[] = accepted.map((f) => ({ file: f, status: "pending" }));
    setResults((prev) => {
      const startIndex = prev.length;
      const updated = [...prev, ...newItems];
      newItems.forEach((_, i) => setTimeout(() => uploadFile(accepted[i], startIndex + i), i * 200));
      return updated;
    });
  }, [uploadFile]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED,
    multiple: true,
  });

  const removeItem = (index: number) => {
    setResults((prev) => prev.filter((_, i) => i !== index));
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  };

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={clsx(
          "border-2 border-dashed p-10 text-center cursor-pointer transition-colors",
          isDragActive
            ? "border-[#A100FF] bg-[#F3E0FF]"
            : "border-[#E0E0E0] hover:border-[#A100FF] hover:bg-[#F2F2F2]"
        )}
      >
        <input {...getInputProps()} />
        <Upload className="w-10 h-10 mx-auto text-[#6A6A6A] mb-3" />
        {isDragActive ? (
          <p className="text-[#A100FF] font-medium">Déposez les fichiers ici...</p>
        ) : (
          <>
            <p className="text-black font-medium">Glissez-déposez vos documents</p>
            <p className="text-[#6A6A6A] text-sm mt-1">ou cliquez pour sélectionner</p>
            <p className="text-[#6A6A6A] text-xs mt-2">PDF, Word, Excel, TXT — Classification automatique par IA</p>
          </>
        )}
      </div>

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((result, index) => (
            <div key={index} className="flex items-center gap-3 p-3 bg-white border border-[#E0E0E0]">
              <FileText className="w-5 h-5 text-[#6A6A6A] shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-black truncate">{result.file.name}</p>
                  <span className="text-xs text-[#6A6A6A] shrink-0">{formatSize(result.file.size)}</span>
                </div>
                {result.status === "done" && result.document && (
                  <div className="flex items-center gap-2 mt-0.5">
                    <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                    <span className="text-xs text-green-700 font-medium">{result.document.category}</span>
                    {result.document.ai_confidence && (
                      <span className="text-xs text-[#6A6A6A]">
                        ({Math.round(result.document.ai_confidence * 100)}% confiance)
                      </span>
                    )}
                  </div>
                )}
                {result.status === "error" && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <AlertCircle className="w-3.5 h-3.5 text-[#FF3333]" />
                    <span className="text-xs text-[#FF3333]">{result.error}</span>
                  </div>
                )}
              </div>
              <div className="shrink-0">
                {result.status === "uploading" && <Loader2 className="w-4 h-4 text-[#A100FF] animate-spin" />}
                {result.status === "done" && <CheckCircle className="w-4 h-4 text-green-500" />}
                {result.status === "error" && <AlertCircle className="w-4 h-4 text-[#FF3333]" />}
                {result.status === "pending" && (
                  <button onClick={() => removeItem(index)}>
                    <X className="w-4 h-4 text-[#6A6A6A] hover:text-black" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
