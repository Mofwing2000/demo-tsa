import React, { useEffect, useRef, useState } from "react";
import { IcRefresh } from "../../assets";
import {
  Button,
  notification,
  Radio,
  RadioChangeEvent,
  Space,
  Tooltip,
  Modal,
} from "antd";
import useSign from "../../hooks/useSign";
import axiosInstance from "../../api/request";

interface IProps {
  currentBatchId: string;
  setStep: React.Dispatch<React.SetStateAction<number>>;
  totalCertNumber: number
}

type SetNumberData = number;
type HashCert = {
  certId: string;
  signatureId: string;
  sh: string;
};

type FailSet = {
  failCerts?: HashCert[];
};

enum SIGN_STATUS {
  INIT = "INIT",
  PENDING = "PENDING",
  PROCESSED = "PROCESSED",
  ERROR = "ERROR",
  SUCCEED = "SUCCEED",
}

const SignStep = ({ currentBatchId, setStep, totalCertNumber }: IProps) => {
  const [selectedAlias, setSelectedAlias] = useState<string>();
  const [aliases, setAliases] = useState<string[]>([]);
  const [failedSets, setFailedSets] = useState<Record<string, FailSet>>({});
  const [signStatus, setSignStatus] =
    useState<keyof typeof SIGN_STATUS>("INIT");

  //timer
  const [signDuration, setSignDuration] = useState<number | undefined>();
  const batchProgressIntervalRef = useRef<number>();

  const { getUSBAliases, signMessage } = useSign();
  let _eventSource: any = null;

  const { confirm } = Modal;

  const showConfirm = () => {
    confirm({
      title: "Bạn có chắc chắn muốn ký usb cho các chứng nhận trên?",
      onOk() {
        signUSB();
      },
      onCancel() {
        console.log("Cancel");
      },
    });
  };

  const handleClickSign = () => {
    if (!selectedAlias)
      return notification.warning({
        message: "Vui lòng chọn usb bạn muốn ký!",
      });
    showConfirm();
  }

  const signCertWithRetry = async (
    cert: HashCert,
    offset: number,
    batchId: string,
    retries: number = 3
  ) => {
    try {
      const signedHashCert = await signMessage(selectedAlias!, cert?.sh);
      return signedHashCert;
    } catch {
      if (retries > 1) {
        await signCertWithRetry(cert, offset, batchId, retries - 1);
      } else {
        setFailedSets((prev) => ({
          ...prev,
          [`set-${offset}`]: {
            ...prev?.[`set-${offset}`],
            failCerts: [...(prev?.[`set-${offset}`]?.failCerts || []), cert],
          },
        }));
      }
    }
  };

  const signUsbSetCertWithRetry = async (
    offset: number,
    batchId: string,
    retries: number = 3
  ) => {
    try {
      const signedHashCerts = [];
      const hashCertSetResponse = await axiosInstance.get<HashCert[]>(
        `/sign/hashes/${batchId}?offset=${offset}&sigIdx=0`
      );
      for (let cert of hashCertSetResponse?.data) {
        const signedHashCert = await signCertWithRetry(
          cert,
          offset,
          batchId,
          3
        );
        signedHashCerts.push({
          ...cert,
          signature: signedHashCert,
        });
      }
      const signPayload = {
        sig: signedHashCerts,
        batchId,
        offset,
      };
      await axiosInstance.post("/batches/sign", signPayload);
    } catch {
      if (retries > 1)
        await signUsbSetCertWithRetry(offset, batchId, retries - 1);
      else
        setFailedSets((prev) => ({
          ...prev,
          [`set-${offset}`]: {},
        }));
    }
  };


  const signUSB = async () => {
    try {
      setSignDuration(undefined);
      setSignStatus(SIGN_STATUS.PENDING);
      const initTime = Date.now();
      // initEventSource(currentBatchId, initTime);
      const responseGetSetNumber = await axiosInstance.get<SetNumberData>(
        `/batches/set-quantity/${currentBatchId}`
      );
      if (responseGetSetNumber?.data) {
        // const concurrencyLimit = 5;
        // let currentIndex = 0;
        // const queue: Promise<void>[] = [];

        // while (currentIndex < responseGetSetNumber?.data || queue.length > 0) {
        //   // While we're below the concurrency limit, start new uploads
        //   while (
        //     queue.length < concurrencyLimit &&
        //     currentIndex < responseGetSetNumber?.data
        //   ) {
        //     const uploadPromise = signUsbSetCertWithRetry(
        //       currentIndex,
        //       currentBatchId,
        //       3
        //     ).then(() => {
        //       // Remove the completed promise from the queue
        //       queue.splice(queue.indexOf(uploadPromise), 1);
        //     });
        //     queue.push(uploadPromise); // Add the promise to the queue
        //   }

        //   // Wait for one of the ongoing uploads to finish before starting a new one
        //   await Promise.race(queue);
        // }

        // sign one by one
        for (let i = 0; i < responseGetSetNumber?.data; i++) {
          await signUsbSetCertWithRetry(i, currentBatchId, 3);
        }
        batchProgressIntervalRef.current = setInterval(() => {
          sweepData(currentBatchId, totalCertNumber)
        }, 5000)
      }
      setSignStatus(SIGN_STATUS.PROCESSED);
    } catch {
      notification.error({
        message: "Đã có lỗi trong quá trình ký",
      });
      setSignStatus(SIGN_STATUS.ERROR);
    }
  };

  const getAliases = async () => {
    try {
      const listAliases = await getUSBAliases();
      setAliases(listAliases);
    } catch {
      notification.error({
        message:
          "Có lỗi trong quá trình lấy danh sách usb ký số. Vui lòng thử lại!",
      });
    }
  };

  const handleChooseAlias = (e: RadioChangeEvent) => {
    setSelectedAlias(e?.target?.value);
  };

  const retryFailCertSign = (batchId: string) => {
    setFailedSets({});
    Object.keys(failedSets).forEach(async (key) => {
      const failCerts = failedSets?.[key]?.failCerts;
      const offset = Number(key?.split("-")?.[1]);
      if (failCerts) {
        failCerts?.forEach(async (cert) => {
          await signCertWithRetry(cert, offset, batchId, 1);
        });
      } else await signUsbSetCertWithRetry(offset, batchId, 1);
    });
  };

  // const initEventSource = (batchId: string, initTime: number) => {
  //   const url = BASE_URL + `/batches/${batchId}/signed`;
  //   _eventSource = new EventSource(url);
  //   (_eventSource as EventSource).onmessage = () => {
  //     notification.success({
  //       message: `Đã ký thành công tất cả chứng nhận`,
  //     });
  //     setSignDuration((Date.now() - initTime) / 100);
  //     setSignStatus(SIGN_STATUS.SUCCEED);
  //     _eventSource.close();
  //   };
  // };

  // useEffect(() => {
  //   return () => {
  //     _eventSource?.close();
  //   };
  // }, []);

  const sweepData = async (batchId: string, totalCertNumber: number) => {
    const getBatchProgressResponse = await axiosInstance.get(
      `/batches/get-progress/${batchId}`
    );
    if (
      getBatchProgressResponse?.data?.status === "SIGNED" &&
      getBatchProgressResponse?.data?.docCount === totalCertNumber
    ) {
      clearInterval(batchProgressIntervalRef.current)
      setSignStatus(SIGN_STATUS.SUCCEED);
      notification.success({
        message: "Đã ký và xử lý thành công tất cả chứng nhận.",
      });
    }
  };

  useEffect(() => {
    getAliases();
  }, []);

  useEffect(() => {
    if (signStatus === SIGN_STATUS.PROCESSED) {
      if (Object.keys(failedSets).length) {
        setSignStatus(SIGN_STATUS.ERROR);
        notification.error({
          message: "Đã có lỗi trong quá trình ký, vui lòng thử lại",
        });
      } else {
        notification.warning({
          message: "Đã ký thành công tất cả chứng nhận. Vui lòng chờ hệ thống xử lý trong ít phút",
        });
      }
    }
  }, [signStatus, failedSets]);

  return (
    <div className="flex justify-center">
      <div className="max-w-sm md:max-w-lg grow">
        <div className="flex justify-between items-center mb-3">
          <div className="text-xl font-bold">Danh sách USB ký số:</div>
          <Tooltip title="Cập nhật danh sách usb">
            <Button className="cursor-pointer" onClick={getAliases}>
              <IcRefresh />
            </Button>
          </Tooltip>
        </div>

        <div>
          {aliases?.length > 0 ? (
            <Radio.Group onChange={handleChooseAlias} value={selectedAlias}>
              <Space direction="vertical" className="py-2">
                {aliases.map((alias) => (
                  <Radio value={alias}>{alias}</Radio>
                ))}
              </Space>
            </Radio.Group>
          ) : (
            "Không tìm thấy usb ký số"
          )}
        </div>
        {/* <div className="flex gap-x-8 items-center justify-center">
          Thời gian ký: {signDuration || ""}
        </div> */}
        <div className="max-w-sm md:max-w-lg grow flex justify-center mt-10">
          {signStatus === SIGN_STATUS.INIT ||
          signStatus === SIGN_STATUS.PROCESSED ||
          signStatus === SIGN_STATUS.PENDING ? (
            <Button
              className="w-24"
              type="primary"
              onClick={handleClickSign}
              loading={
                signStatus === SIGN_STATUS.PENDING ||
                signStatus === SIGN_STATUS.PROCESSED
              }
            >
              Ký
            </Button>
          ) : null}
          {signStatus === SIGN_STATUS.ERROR ? (
            <Button
              className="w-24"
              type="primary"
              danger
              onClick={() => retryFailCertSign(currentBatchId)}
            >
              Thử lại
            </Button>
          ) : null}
          {signStatus === SIGN_STATUS.SUCCEED ? (
            <Button
              className="w-24"
              type="primary"
              onClick={() => setStep((step) => step + 1)}
            >
              Tiếp theo
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default SignStep;
