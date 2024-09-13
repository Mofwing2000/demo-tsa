import React, { useEffect, useState } from "react";
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
import axiosInstance, { BASE_URL } from "../../api/request";
import { AxiosResponse } from "axios";

interface IProps {
    currentBatchId: string;
    setStep: React.Dispatch<React.SetStateAction<number>>;
}

type SetNumberData = number;
type HashCert = {
    certId: string;
    signatureId: string;
    sh: string;
};

type SignedHashCert = HashCert & {
    signature: string
}

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

const SignStep = ({ currentBatchId, setStep }: IProps) => {
    const [selectedAlias, setSelectedAlias] = useState<string>();
    const [aliases, setAliases] = useState<string[]>([]);
    const [hashedStrings, setHashedStrings] = useState<string[]>();
    const [failedSets, setFailedSets] = useState<Record<string, FailSet>>({});
    const [signStatus, setSignStatus] =
        useState<keyof typeof SIGN_STATUS>("INIT");

    const { getUSBAliases, signMessage } = useSign();
    let _eventSource: any = null;

    const { confirm } = Modal;

    const showConfirm = () => {
        confirm({
            title: "Bạn có chắc chắn muốn ký usb cho các chứng nhận trên?",
            // icon: <ExclamationCircleFilled />,
            // content: 'Some descriptions',
            onOk() {
                signUSB();
            },
            onCancel() {
                console.log("Cancel");
            },
        });
    };

    const signCert = async (hashedStrings: string[]) => {
        try {
            const signedHashCerts = [];
            for (const hash of hashedStrings) {
                const hashedCert = await signMessage(selectedAlias!, hash!);
                signedHashCerts.push(hashedCert);
            }
            return signedHashCerts;
        } catch (e) {
            console.log(e);
        }
    };

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
            }
            else {
                setFailedSets(prev => ({
                    ...prev,
                    [`set-${offset}`]: {
                        ...prev?.[`set-${offset}`],
                        failCerts: [
                            ...(prev?.[`set-${offset}`]?.failCerts || []),
                            cert,
                        ],
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
                    signature: signedHashCert
                })
            }
            const signPayload = {
                sig: signedHashCerts,
                batchId,
                offset
            }
            await axiosInstance.post('/batches/sign', signPayload, {
                headers: {
                    "Content-Type": "application/json"
                }
            })
        } catch {
            if (retries > 1)
                await signUsbSetCertWithRetry(offset, batchId, retries - 1);
            else
                setFailedSets(prev => ({
                    ...prev,
                    [`set-${offset}`]: {},
                }));
        }
    };

    const signUSB = async () => {
        try {
            setSignStatus(SIGN_STATUS.PENDING);
            const responseGetSetNumber = await axiosInstance.get<SetNumberData>(
                `/batches/set-quantity/${currentBatchId}`
            );
            if (responseGetSetNumber?.data) {
                for (let i = 0; i < responseGetSetNumber?.data; i++) {
                    await signUsbSetCertWithRetry(i, currentBatchId, 3);
                }
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
        console.log(failedSets, 'failedSets')
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

    const initEventSource = (batchId: string) => {
        const url = BASE_URL + `/batches/${batchId}/signed`;
        _eventSource = new EventSource(url);
        (_eventSource as EventSource).onmessage = () => {
            notification.success({
                message: `Đã ký lên thành công tất cả chứng nhận`,
            });
            _eventSource.close()
            // setUploadingState(UPLOAD_STATE.SUCCEED);
        };
    };

    useEffect(() => {
        if (currentBatchId ) {
            initEventSource(currentBatchId);
        }
        return () => {
            _eventSource?.close();
        };
    }, [currentBatchId]);

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
                setSignStatus(SIGN_STATUS.SUCCEED);
                notification.success({
                    message: "Đã ký thành công tất cả chứng nhận",
                });
            }
        }
    }, [signStatus, failedSets]);

    return (
        <div className="flex justify-center">
            <div className="max-w-sm md:max-w-lg grow">
                <div className="flex justify-between items-center mb-3">
                    <div className="text-xl font-bold">
                        Danh sách USB ký số:
                    </div>
                    <Tooltip title="Cập nhật danh sách usb">
                        <Button className="cursor-pointer" onClick={getAliases}>
                            <IcRefresh />
                        </Button>
                    </Tooltip>
                </div>

                <div>
                    {aliases?.length > 0 ? (
                        <Radio.Group
                            onChange={handleChooseAlias}
                            value={selectedAlias}
                        >
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
                <div className="max-w-sm md:max-w-lg grow flex justify-center mt-10">
                    {signStatus === SIGN_STATUS.INIT ||
                    signStatus === SIGN_STATUS.PENDING ? (
                        <Button
                            className="w-24"
                            type="primary"
                            onClick={showConfirm}
                        >
                            Ký
                        </Button>
                    ) : null}
                    {
                        signStatus === SIGN_STATUS.ERROR ? (
                            <Button
                            className="w-24"
                            type="primary"
                            danger
                            onClick={() => retryFailCertSign(currentBatchId)}
                        >
                            Thử lại
                        </Button>
                        ) : null
                    }
                    {
                        signStatus === SIGN_STATUS.SUCCEED ? (
                            <Button
                            className="w-24"
                            type="primary"
                            onClick={showConfirm}
                        >
                            Tiếp theo
                        </Button>
                        ) : null
                    }
                </div>
            </div>
            {/* <Modal></Modal> */}
        </div>
    );
};

export default SignStep;
