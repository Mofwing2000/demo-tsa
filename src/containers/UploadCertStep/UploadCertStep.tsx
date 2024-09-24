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

enum UPLOAD_STATE {
  IDLE = "IDLE",
  PENDING = "PENDING",
  RETRYING = "RETRYING",
  SUCCEED = "SUCCEED",
  FAILED = "FAILED",
  PROCESSING = "PROCESSING",
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
  setStep: (step: number) => void;
  setCurrentBatchId: (batchId: string) => void;
  selectedCertList: File[];
  setSelectedCertList: (files: File[]) => void;
}

type FileUploadError = {
  error: string;
  files: Array<string>;
};

const UploadCertStep: React.FC<UploadCertStepProps> = ({
  setStep,
  currentBatchId,
  setCurrentBatchId,
  selectedCertList,
  setSelectedCertList,
}) => {
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [failedFiles, setFailedFiles] = useState<File[]>([]);
  const [uploadingState, setUploadingState] = useState<
    keyof typeof UPLOAD_STATE
  >(UPLOAD_STATE.IDLE);
  const [ processedCount, setProcessedCount] = useState(0)

  //timer
  const [uploadDuration, setUploadDuration] = useState<number | undefined>();

  const inputRef = useRef<HTMLInputElement | null>(null);
  const uploadRef = useRef<HTMLDivElement>(null);
  const batchProgressIntervalRef = useRef<number>();
  const abortControllerRef = useRef<AbortController | null>(null);
  let _eventSource: any = null;

  const MAX_RETRY = Number(import.meta.env.VITE_MAX_RETRY);
  const SET_SIZE = Number(import.meta.env.VITE_SET_SIZE);
  const SWEEP_INTERVAL= Number(import.meta.env.VITE_DATA_SWEEP_INTERVAL);
  const CONCURRENT_LIMIT= Number(import.meta.env.VITE_UPLOAD_CONCURRENT_LIMIT);
  const TEMPLATE_ID= import.meta.env.VITE_TEMPLATE_ID;

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
    retries = MAX_RETRY
  ) => {
    try {
      await sendFiles(files, batchId);
      setUploadedFiles((prev) => [...prev, ...files]);
    } catch (error: any) {
      if (retries > 0) {
        if ((error as FileUploadError)?.files) {
          const errorFiles = files.filter((file) =>
            error?.files.includes(file.name)
          );
          const uploadedFiles = files.filter(
            (file) => !error?.files.includes(file.name)
          );
          setUploadedFiles((prev) => [...prev, ...uploadedFiles]);
          await sendFilesWithRetry(errorFiles, batchId, retries - 1);
        } else {
          await sendFilesWithRetry(files, batchId, retries - 1);
        }
      } else {
        setFailedFiles((prev) => [...prev, ...files]);
      }
    }
  };

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

  //batch upload
  const handleBatchUpload = async (
    files: File[],
    batchId: string,
    maxRetries = MAX_RETRY
  ) => {
    // setUploadDuration(undefined);
    // const initTime = Date.now();
    // initEventSource(batchId, initTime);
    // dispatchEvent(eventBatchProgress);
    const concurrencyLimit = CONCURRENT_LIMIT; // Limit to 5 concurrent uploads
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

  // const handleBatchUpload = async (
  //   files: File[],
  //   batchId: string,
  //   maxRetries = MAX_RETRY
  // ) => {
  //   try {
  //     // dispatchEvent(eventBatchProgress);
  //     setUploadDuration(undefined);
  //     const initTime = Date.now();
  //     // initEventSource(batchId, initTime);
  //     for (let i = 0; i < files.length; i += SET_SIZE) {
  //       const fileBatch = files.slice(i, i + SET_SIZE);
  //       await sendFilesWithRetry(fileBatch, batchId, maxRetries);
  //     }
  //     batchProgressIntervalRef.current = setInterval(() => {
  //       sweepData(batchId, files?.length);
  //     }, 5000)
  //   } catch {}
  // };
  const handleRetryAllFail = async () => {
    setFailedFiles([]);
    setUploadingState(UPLOAD_STATE.RETRYING);
    await handleBatchUpload(failedFiles, currentBatchId, 1);
  };

  const handleUploadInit = async () => {
    setUploadingState(UPLOAD_STATE.PENDING);
    try {
      const result = await axiosInstance.post("/batches/create", {
        title: "Title",
        templateId: TEMPLATE_ID,
        institutionName: "HUST",
        size: selectedCertList?.length,
      });
      // const result = {
      //   data: {
      //     detail: '06eeef6b-a1d3-445b-bf3b-7bfbbbdda78d'
      //   }
      // }
      setCurrentBatchId(result?.data?.detail);
      await handleBatchUpload(selectedCertList, result?.data?.detail);
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
    setUploadedFiles([]);
    setFailedFiles([]);
    setUploadDuration(undefined);
    setUploadingState(UPLOAD_STATE.IDLE);
  };

  const initEventSource = (batchId: string, initTime: number) => {
    const url = BASE_URL + `/batches/${batchId}/created`;
    _eventSource = new EventSource(url);
    (_eventSource as EventSource).onmessage = () => {
      notification.success({
        message: `Đã tải lên thành công tất cả ${selectedCertList.length} chứng nhận`,
      });
      setUploadDuration((Date.now() - initTime) / 1000);
      _eventSource.close();
      setUploadingState(UPLOAD_STATE.SUCCEED);
    };
  };

  const sweepData = async (batchId: string, totalCertNumber: number) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const getBatchProgressResponse = await axiosInstance.get(
      `/batches/get-progress/${batchId}`,
      { signal: controller.signal }
    );
    controller.abort();
    if(getBatchProgressResponse?.data?.status === "CREATED" || getBatchProgressResponse?.data?.status === "PENDING_CREATE"){
      setProcessedCount(getBatchProgressResponse?.data?.docCount)
    }
    if (
      getBatchProgressResponse?.data?.status === "CREATED" &&
      getBatchProgressResponse?.data?.docCount === totalCertNumber
    ) {
      notification.success({
        message: `Các chứng nhận đã đươc tải và xử lý thành công.`,
      });
      clearInterval(batchProgressIntervalRef.current);
      setUploadingState(UPLOAD_STATE.SUCCEED);
    }
  };

  const getMessageTitle = () => {
    if (
      uploadingState === UPLOAD_STATE.PENDING ||
      uploadingState === UPLOAD_STATE.RETRYING
    )
      return `Đang upload: ${uploadedFiles?.length}/${selectedCertList?.length} chứng nhận đã tải lên`;
    if (uploadingState === UPLOAD_STATE.PROCESSING)
      return `Đang xử lý: ${processedCount}/${selectedCertList?.length} chứng nhận đã xử lý`;
    if (uploadingState === UPLOAD_STATE.FAILED)
      return `Đã xảy ra lỗi: ${uploadedFiles?.length}/${selectedCertList?.length} chứng nhận đã tải lên`;
    if (uploadingState === UPLOAD_STATE.SUCCEED)
      return `Tất cả chứng nhận đã được tải lên và xử lý thành công`;
  };

  // useEffect(() => {
  //   return () => {
  //     _eventSource?.close();
  //   };
  // }, [currentBatchId, uploadingState]);

  useEffect(() => {
    if (
      selectedCertList?.length &&
      selectedCertList?.length === failedFiles?.length + uploadedFiles?.length
    ) {
      if (failedFiles?.length) {
        setUploadingState(UPLOAD_STATE.FAILED);
        notification.error({
          message: `Đã có ${failedFiles?.length} chứng nhận đã tải lên thất bại`,
        });
      } else {
        setUploadingState(UPLOAD_STATE.PROCESSING);
        notification.warning({
          message:
            "Các chứng chỉ đã được tải lên thành công. Vui lòng chờ hệ thống xử lý trong ít phút",
        });
        batchProgressIntervalRef.current = setInterval(() => {
          sweepData(currentBatchId, selectedCertList?.length);
        }, SWEEP_INTERVAL);
      }
    }
  }, [failedFiles, uploadedFiles, selectedCertList]);

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
        </>
      ) : (
        <>
          <div className="flex justify-center	">
            {/* <Button onClick={() => {dispatchEvent()}}>fasdfasdfasd</Button> */}
            <Progress
              size={200}
              type="circle"
              strokeLinecap="butt"
              percent={Number(
                (
                  (uploadedFiles?.length * 100) /
                  selectedCertList?.length
                ).toFixed(0)
              )}
              status={
                uploadingState === UPLOAD_STATE.PENDING ||
                uploadingState === UPLOAD_STATE.PROCESSING || 
                uploadingState === UPLOAD_STATE.RETRYING
                  ? "normal"
                  : uploadingState === UPLOAD_STATE.SUCCEED
                  ? "success"
                  : "exception"
              }
                success={{
                  percent: Number(
                    (
                      (processedCount * 100) /
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
                  {getMessageTitle()}
                </div>
              )}
            />
          </div>
        </>
      )}
      <div>
        {uploadingState === UPLOAD_STATE.IDLE ||
        uploadingState === UPLOAD_STATE.PENDING ||
        uploadingState === UPLOAD_STATE.PROCESSING ? (
          <div className="flex items-center justify-center">
            <Button
              onClick={handleUploadInit}
              className="mt-10"
              type="primary"
              disabled={!selectedCertList?.length}
              loading={
                uploadingState === UPLOAD_STATE.PENDING ||
                uploadingState === UPLOAD_STATE.PROCESSING
              }
            >
              Upload
            </Button>
          </div>
        ) : (
          <>
            {/* <div className="flex gap-x-8 items-center justify-center">
              Thời gian upload: {uploadDuration || ""}
            </div> */}
            <div className="flex gap-x-8 items-center justify-center mt-6">
              {uploadingState === UPLOAD_STATE.FAILED ||
              uploadingState === UPLOAD_STATE.RETRYING ? (
                <Button
                  className="w-20"
                  type="primary"
                  onClick={handleRetryAllFail}
                  loading={uploadingState === UPLOAD_STATE.RETRYING}
                >
                  Tải lại
                </Button>
              ) : (
                <Button
                  className="w-20"
                  type="primary"
                  onClick={() => setStep(1)}
                >
                  Tiếp theo
                </Button>
              )}
              <Button
                className="w-20"
                ghost
                danger
                onClick={handleReset}
                loading={uploadingState === UPLOAD_STATE.RETRYING}
              >
                Huỷ
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default UploadCertStep;
