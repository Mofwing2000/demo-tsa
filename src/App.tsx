import { useState } from "react";
import "./App.css";
import FullFlow from "./containter/FullFlow";
import { Layout } from "antd";
import { Content, Footer, Header } from "antd/es/layout/layout";
import Sider from "antd/es/layout/Sider";

function App() {
    return (
        <>
            <Layout>
                <Header style={{color: 'white'}}>Header</Header>
                <Layout>
                  <Sider style={{height: 'calc(100vh - 64px)'}}>
                    <div style={{height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white'}}>
                      Sider
                    </div>
                  </Sider>
                  <Content>
                      <FullFlow />
                  </Content>
                </Layout>
            </Layout>
        </>
    );
}

export default App;
