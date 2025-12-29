/**
 * サービスプロバイダーのインターフェース
 */
export interface IServiceProvider {
  /**
   * サービスを取得
   */
  getService<T>(name: string): T;

  /**
   * サービスが利用可能かチェック
   */
  hasService(name: string): boolean;
}

/**
 * 設定可能なサービスプロバイダー
 */
export interface IConfigurableServiceProvider extends IServiceProvider {
  /**
   * サービスを設定
   */
  setService<T>(name: string, service: T): void;

  /**
   * サービスファクトリを設定
   */
  setServiceFactory<T>(name: string, factory: () => T): void;
}
