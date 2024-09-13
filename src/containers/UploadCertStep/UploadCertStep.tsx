import React, { useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Button, notification, Progress } from "antd";
import axiosInstance, { BASE_URL } from "../../api/request";

declare module "react" {
  interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
    directory?: string;
    webkitdirectory?: string;
  }
}
const MAX_RETRIES = 3;
const SET_SIZE = 10;

enum UPLOAD_STATE {
  IDLE = "IDLE",
  PENDING = "PENDING",
  SUCCEED = "SUCCEED",
  FAILED = "FAILED",
  UPLOADED = "UPLOADED",
}

const baseStyle = {
  flex: 1,
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  padding: "40px",
  borderWidth: 4,
  borderRadius: 4,
  borderColor: "#eeeeee",
  borderStyle: "dashed",
  color: "rgba(0,0,0,0.7)",
  transition: "border .24s ease-in-out",
};

const activeStyle = {
  borderColor: "#2196f3",
};

interface UploadCertStepProps {
  currentBatchId: string;
  setStep: React.Dispatch<React.SetStateAction<number>>;
  setCurrentBatchId: React.Dispatch<React.SetStateAction<string>>;
}

type FileUploadError = {
  error: string;
  files: Array<string>;
};

const UploadCertStep: React.FC<UploadCertStepProps> = ({
  setStep,
  currentBatchId,
  setCurrentBatchId,
}) => {
  const [selectedCertList, setSelectedCertList] = useState<File[]>([]);
  const [succeedFiles, setSucceedFiles] = useState<File[]>([]);
  const [failedFiles, setFailedFiles] = useState<File[]>([]);
  const [uploadingState, setUploadingState] = useState<
    keyof typeof UPLOAD_STATE
  >(UPLOAD_STATE.IDLE);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const uploadRef = useRef<HTMLDivElement>(null);

  let _eventSource: any = null;

  const onDrop = async (acceptedFiles: File[]) => {
    const pdfFileList = acceptedFiles?.filter(
      (file) => file?.type === "application/pdf"
    );
    setSelectedCertList(pdfFileList);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onDrop,
    noClick: false, // Disable default click behavior
    noKeyboard: true, // Disable default keyboard behavior
    multiple: true,
    accept: {
      "application/pdf": [".pdf"],
    },
  });

  const styleDropZone = useMemo(
    () => ({
      ...baseStyle,
      ...(isDragActive ? activeStyle : {}),
    }),
    [isDragActive]
  );

  const sendFilesWithRetry = async (
    files: File[],
    batchId: string,
    retries = MAX_RETRIES
  ) => {
    try {
      await sendFiles(files, batchId);
      setSucceedFiles((prev) => [...prev, ...files]);
    } catch (error: any) {
      if (retries > 1) {
        if ((error as FileUploadError)?.files) {
          const errorFiles = files.filter((file) =>
            error?.files.includes(file.name)
          );
          const succeedFiles = files.filter(
            (file) => !error?.files.includes(file.name)
          );
          setSucceedFiles((prev) => [...prev, ...succeedFiles]);
          await sendFilesWithRetry(errorFiles, batchId, retries - 1);
        } else {
          await sendFilesWithRetry(files, batchId, retries - 1);
        }
      } else {
        setFailedFiles((prev) => [...prev, ...files]);
      }
    }
  };

//   useEffect(() => {
//     if (
//       selectedCertList?.length &&
//       selectedCertList?.length === failedFiles?.length + succeedFiles?.length
//     ) {
//       if (failedFiles?.length) {
//         setUploadingState(UPLOAD_STATE.FAILED);
//         notification.error({
//           message: `Đã có ${failedFiles?.length} chứng nhận đã tải lên thất bại`,
//         });
//       } else {
//         setUploadingState(UPLOAD_STATE.UPLOADED);
//       }
//     }
//   }, [failedFiles, succeedFiles, selectedCertList]);

  const sendFiles = async (files: File[], batchId: string): Promise<void> => {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append("files", file, file?.name);
    });

    const response = await axiosInstance.post(
      "/storage/upload-multiple",
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
        params: {
          batchId: batchId,
        },
      }
    );

    if (response.status !== 200) {
      throw new Error("Upload failed");
    }
  };

  const handleBatchUpload = async (
    files: File[],
    batchId: string,
    maxRetries = MAX_RETRIES
) => {
    const concurrencyLimit = 5; // Limit to 5 concurrent uploads
    let currentIndex = 0; // Index to track which file batch to upload next
    const queue: Promise<void>[] = []; // To keep track of ongoing uploads

    // Helper function to upload a batch of files
    const uploadNextBatch = async () => {
        if (currentIndex >= files.length) return; // All files processed

        const fileBatch = files.slice(currentIndex, currentIndex + SET_SIZE);
        currentIndex += SET_SIZE; // Move to the next batch

        try {
            await sendFilesWithRetry(fileBatch, batchId, maxRetries);
        } catch (error) {
            console.error("Error uploading file batch:", error);
        }
    };

    // Start uploading while maintaining the concurrency limit
    while (currentIndex < files.length || queue.length > 0) {
        // While we're below the concurrency limit, start new uploads
        while (queue.length < concurrencyLimit && currentIndex < files.length) {
            const uploadPromise = uploadNextBatch().then(() => {
                // Remove the completed promise from the queue
                queue.splice(queue.indexOf(uploadPromise), 1);
            });
            queue.push(uploadPromise); // Add the promise to the queue
        }

        // Wait for one of the ongoing uploads to finish before starting a new one
        await Promise.race(queue);
    }
};

  const handleRetryAllFail = async () => {
    setFailedFiles([]);
    await handleBatchUpload(failedFiles, currentBatchId, 1);
  };

  const handleUploadInit = async () => {
    setUploadingState(UPLOAD_STATE.PENDING);
    try {
      const result = await axiosInstance.post(
        "/batches/create",
        {
          title: "Title",
          templateId: "4a5e361f-6f49-4700-8dc4-c5d764382008",
          institutionName: "HUST",
          size: selectedCertList?.length,
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
      const init = Date.now();
      await handleBatchUpload(selectedCertList, result?.data?.detail);
      setUploadingState(UPLOAD_STATE.SUCCEED);
      const end = Date.now();
      alert((end - init) / 1000);
      // setTimeout(() => {
      // }, 3000);
      setCurrentBatchId(result?.data?.detail);
    } catch (e) {
      setUploadingState(UPLOAD_STATE.IDLE);
      notification.error({
        message: "Quá trình tạo lô bị lỗi vui lòng thử lại",
      });
    }
  };

  const handleReset = () => {
    setCurrentBatchId("");
    setSelectedCertList([]);
    setSucceedFiles([]);
    setFailedFiles([]);
    setUploadingState(UPLOAD_STATE.IDLE);
  };

//   const initEventSource = (batchId: string) => {
//     const url = BASE_URL + `/batches/${batchId}/created`;
//     _eventSource = new EventSource(url);
//     (_eventSource as EventSource).onmessage = () => {
//       notification.success({
//         message: `Đã tải lên thành công tất cả ${selectedCertList.length} chứng nhận`,
//       });
//       _eventSource.close();
//       setUploadingState(UPLOAD_STATE.SUCCEED);
//     };
//   };

//   useEffect(() => {
//     if (currentBatchId && uploadingState === UPLOAD_STATE.UPLOADED) {
//       initEventSource(currentBatchId);
//     }
//     return () => {
//       _eventSource?.close();
//     };
//   }, [currentBatchId, uploadingState]);

  return (
    <div ref={uploadRef}>
      {uploadingState === UPLOAD_STATE.IDLE ? (
        <>
          <div
            {...getRootProps()}
            style={{
              ...styleDropZone,
              flexDirection: "column",
              cursor:
                uploadingState === UPLOAD_STATE.IDLE
                  ? "pointer"
                  : "not-allowed",
            }}
            onClick={() => {
              if (uploadingState === UPLOAD_STATE.IDLE)
                inputRef?.current?.click();
            }}
          >
            <input
              {...getInputProps()}
              ref={inputRef}
              type="file"
              webkitdirectory="true"
              directory="true"
              multiple
              style={{ display: "none" }}
              accept=""
              onChange={(event) => {
                if (event?.target?.files)
                  onDrop(Array.from(event?.target?.files));
              }}
            />
            <p className="ant-upload-text text-center">
              Kéo thả, hoặc ấn vào để chọn thư mục chứng chỉ cần tải lên
            </p>
            {selectedCertList?.length > 0 ? (
              <p className="text-green-300 text-center">
                {selectedCertList?.length} chứng chỉ đã được chọn
              </p>
            ) : (
              <p className="text-slate-300 text-center">
                Chưa có chứng chỉ nào được chọn
              </p>
            )}
          </div>
          <div className="flex items-center justify-center">
            <Button
              onClick={handleUploadInit}
              className="mt-10"
              type="primary"
              disabled={!selectedCertList?.length}
            >
              Upload
            </Button>
          </div>
        </>
      ) : null}
      {uploadingState === UPLOAD_STATE.PENDING ||
      uploadingState === UPLOAD_STATE.SUCCEED ||
      uploadingState === UPLOAD_STATE.UPLOADED ||
      uploadingState === UPLOAD_STATE.FAILED ? (
        <>
          <div className="flex justify-center	">
            <Progress
              size={200}
              type="circle"
              percent={Number(
                (
                  ((succeedFiles?.length + failedFiles.length) * 100) /
                  selectedCertList?.length
                ).toFixed(0)
              )}
              status={
                uploadingState === UPLOAD_STATE.PENDING ||
                uploadingState === UPLOAD_STATE.UPLOADED
                  ? "normal"
                  : uploadingState === UPLOAD_STATE.SUCCEED
                  ? "success"
                  : "exception"
              }
              success={{
                percent: Number(
                  (
                    (succeedFiles?.length * 100) /
                    selectedCertList?.length
                  ).toFixed(0)
                ),
              }}
              format={() => (
                <div
                  style={{
                    fontSize: "14px",
                    maxWidth: "80%",
                    textAlign: "center",
                    margin: "10%",
                  }}
                >
                  {succeedFiles?.length}/{selectedCertList?.length} chứng chỉ đã
                  upload thành công`
                </div>
              )}
            />
          </div>
          <div className="flex gap-x-8 items-center justify-center mt-6">
            {uploadingState === UPLOAD_STATE.FAILED ? (
              <Button
                className="w-20"
                type="primary"
                onClick={handleRetryAllFail}
              >
                Tải lại
              </Button>
            ) : (
              <Button
                className="w-20"
                type="primary"
                onClick={() => setStep(1)}
                disabled={uploadingState !== UPLOAD_STATE.SUCCEED}
              >
                Tiếp theo
              </Button>
            )}
            <Button
              className="w-20"
              ghost
              danger
              onClick={handleReset}
              disabled={uploadingState !== UPLOAD_STATE.FAILED}
            >
              Huỷ
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
};

export default UploadCertStep;
