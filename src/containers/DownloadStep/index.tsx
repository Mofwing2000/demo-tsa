import { Dispatch, SetStateAction, useState } from "react";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import axiosInstance from "../../api/request";
import { Button, notification, Result, Spin } from "antd";

interface IProps {
  currentBatchId: string;
  setCurrentBatchId: (batchId: string) => void;
  setSelectedCertList: (files: File[]) => void;
  setStep: (step: number) => void;
}

enum DOWNLOAD_STATE {
  IDLE = "IDLE",
  PENDING = "PENDING",
  FINISHED = "FINISHED",
}

const Download = ({
  currentBatchId,
  setCurrentBatchId,
  setSelectedCertList,
  setStep,
}: IProps) => {
  // const [progress, setProgress] = useState<number>(0);
  const [downloadState, setDownloadState] = useState<
    keyof typeof DOWNLOAD_STATE
  >(DOWNLOAD_STATE.IDLE);

  const MAX_RETRY = import.meta.env.VITE_MAX_RETRY;
  const CONCURRENT_LIMIT= import.meta.env.VITE_DOWNLOAD_CONCURRENT_LIMIT;

  const downloadAndZipFiles = async (retryLeft: number = MAX_RETRY) => {
    try {
      const fileLinksResponse = await axiosInstance.get<string[]>(
        `/storage/batch-download?batchId=${currentBatchId}`
      );
      const fileLinks = fileLinksResponse.data;
      setDownloadState(DOWNLOAD_STATE.PENDING);
      const zip = new JSZip();
      let filesDownloaded = 0;
      if (!fileLinks?.length)
        return notification.warning({
          message: "Lô chứng nhận chưa có chứng nhận nào được tải lên",
        });
      const concurrencyLimit = CONCURRENT_LIMIT;
      let currentIndex = 0;
      const queue: Promise<void>[] = [];

      const downloadNextFile = async() => {
        const url = fileLinks[currentIndex];
        try {
          const response = await axiosInstance(url, {
            responseType: "arraybuffer",
          });
          filesDownloaded += 1;
          // setProgress(Math.floor((filesDownloaded / fileLinks.length) * 100));
          const pdfFileBuffer = response.data;
          const fileName = decodeURIComponent(
            decodeURIComponent(url.split("/").pop() || `file-${currentIndex}.txt`)
          );
          zip.file(fileName, new Blob([pdfFileBuffer]));
          currentIndex += 1;
        } catch (error) {
          console.error(`Error downloading file ${url}:`, error);
        }
      };

      while (currentIndex < fileLinks.length || queue.length > 0) {
        // While we're below the concurrency limit, start new uploads
        while (
          queue.length < concurrencyLimit &&
          currentIndex < fileLinks.length
        ) {
          const uploadPromise = downloadNextFile().then(() => {
            // currentIndex+=1;
            // Remove the completed promise from the queue
            queue.splice(queue.indexOf(uploadPromise), 1);
          });
          queue.push(uploadPromise); // Add the promise to the queue
        }

        // Wait for one of the ongoing uploads to finish before starting a new one
        await Promise.race(queue);
      }

      // for (let i = 0; i < fileLinks.length; i++) {
      //   const url = fileLinks[i];
      //   try {
      //     const response = await axiosInstance(url, {
      //       responseType: "arraybuffer",
      //     });
      //     filesDownloaded += 1;
      //     // setProgress(Math.floor((filesDownloaded / fileLinks.length) * 100));
      //     const pdfFileBuffer = response.data;
      //     const fileName = decodeURIComponent(
      //       decodeURIComponent(url.split("/").pop() || `file-${i}.txt`)
      //     );
      //     zip.file(fileName, new Blob([pdfFileBuffer]));
      //   } catch (error) {
      //     console.error(`Error downloading file ${url}:`, error);
      //   }
      // }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      saveAs(zipBlob, "Danh sách chứng nhận.zip");
      setDownloadState(DOWNLOAD_STATE.FINISHED);
    } catch {
      if(retryLeft > 0) {
        downloadAndZipFiles(retryLeft - 1);
      } else {
        notification.error({
          message: "Đã có lỗi trong quá trình tải các chứng nhận.",
        });
        setDownloadState(DOWNLOAD_STATE.IDLE);
      }
    }
  };

  const handleUploadNewBatch = () => {
    setStep(0);
    setSelectedCertList([]);
    setCurrentBatchId("");
  };

  return downloadState === DOWNLOAD_STATE.FINISHED ? (
    <Result
      status="success"
      title="Đã tải thành công các chứng nhận!"
      extra={[
        <Button type="primary" onClick={handleUploadNewBatch}>
          Tải lên đợt mới
        </Button>,
      ]}
    />
  ) : (
    <div className="flex flex-col items-center">
      <div className="text-center mb-20">
        Các chứng nhận đã được ký thành công. Bạn có thể tiến hành tải về các
        chứng nhận đã được ký.
      </div>
      <Button
        type="primary"
        onClick={() => downloadAndZipFiles(3)}
        loading={downloadState === DOWNLOAD_STATE.PENDING}
      >
        Tải về
      </Button>
    </div>
  );
};

export default Download;
