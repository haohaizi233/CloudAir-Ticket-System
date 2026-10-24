const drawQrcode = require('../../utils/weapp-qrcode.js')

Page({
  data: {
    order: {},
    originWeather: null,
    destWeather: null,
    countdown: '',
    countdownStatus: '', // upcoming / urgent / past
    gateInfo: '--',
    carouselInfo: '--',
    flightTimeline: [],
    reminderMinutes: 60,
    reminderSet: false,
    showInvoiceModal: false,
    invoiceInfo: null,
    showShareCard: false,
    shareCardText: '',
    showAirportNav: false,
    airportNavPoints: []
  },

  onLoad(options) {
    if (options.order) {
      const order = JSON.parse(decodeURIComponent(options.order))
      const fullTimeStr = order.flight_info.dept_time || ''
        const timeParts = fullTimeStr.split(' ') 
        const dateStr = timeParts[0] || '待定' 
        const timeStr = timeParts[1] || '--:--'
        // 到达时间
        let arrTimeStr = '--:--'
        if (order.flight_info.arr_time) {
          arrTimeStr = order.flight_info.arr_time.includes(' ') ? order.flight_info.arr_time.split(' ')[1] : order.flight_info.arr_time
        }
        
        this.setData({ 
          order,
          myDate: dateStr,
          myTime: timeStr,
          myArrTime: arrTimeStr,
          isQrLoading: order.status === 1,
          isRefunded: order.status === 2
        })
        // 计算飞行时长
        let flightDuration = ''
        if (timeStr !== '--:--' && arrTimeStr !== '--:--' && arrTimeStr !== '待定') {
          const [dh, dm] = timeStr.split(':').map(Number)
          const [ah, am] = arrTimeStr.split(':').map(Number)
          let totalMin = (ah * 60 + am) - (dh * 60 + dm)
          if (totalMin < 0) totalMin += 24 * 60
          const hours = Math.floor(totalMin / 60)
          const mins = totalMin % 60
          flightDuration = hours > 0 ? `${hours}h${mins > 0 ? mins + 'm' : ''}` : `${mins}m`
        }
        this.setData({ flightDuration })
        // 加载天气提示
        this.loadWeatherTips(order.flight_info.origin, order.flight_info.dest)
        // 启动倒计时
        this.startCountdown(fullTimeStr)
        // 生成登机口信息（基于航班号模拟）
        this.generateGateInfo(order.flight_info.flight_no)
        // 生成行李转盘信息
        this.generateCarouselInfo(order.flight_info.flight_no)
        // 生成航班动态时间线
        this.generateFlightTimeline(fullTimeStr, order.flight_info.flight_no)
      if (order.status === 2) return
      const content = this.generateQRContent(order)
      setTimeout(() => {
        this.drawMyQRCode(content)
      }, 600)
    }
  },

  // 加载天气提示（基于城市名称生成模拟天气数据）
  loadWeatherTips(origin, dest) {
    const weatherTypes = [
      { icon: '☀️', desc: '晴', temp: '28°C', tip: '天气晴好，适合出行' },
      { icon: '⛅', desc: '多云', temp: '25°C', tip: '多云天气，气温适宜' },
      { icon: '🌧️', desc: '小雨', temp: '20°C', tip: '有小雨，请携带雨具' },
      { icon: '🌤️', desc: '晴转多云', temp: '26°C', tip: '天气变化，注意增减衣物' },
      { icon: '💨', desc: '大风', temp: '18°C', tip: '风力较大，注意防风' },
      { icon: '🌫️', desc: '雾', temp: '15°C', tip: '有雾天气，航班可能延误' }
    ]
    // 根据城市名生成固定随机天气（同一城市每次结果一致）
    const getWeather = (city) => {
      if (!city) return null
      let hash = 0
      for (let i = 0; i < city.length; i++) {
        hash = ((hash << 5) - hash) + city.charCodeAt(i)
        hash |= 0
      }
      const index = Math.abs(hash) % weatherTypes.length
      return { city, ...weatherTypes[index] }
    }
    this.setData({
      originWeather: getWeather(origin),
      destWeather: getWeather(dest)
    })
  },

  // 生成登机口信息
  generateGateInfo(flightNo) {
    if (!flightNo) {
      this.setData({ gateInfo: '--' })
      return
    }
    // 基于航班号生成固定登机口
    let hash = 0
    for (let i = 0; i < flightNo.length; i++) {
      hash = ((hash << 5) - hash) + flightNo.charCodeAt(i)
      hash |= 0
    }
    const gateNum = Math.abs(hash) % 30 + 1
    const gateLetter = String.fromCharCode(65 + (Math.abs(hash) % 4)) // A-D
    this.setData({ gateInfo: `${gateLetter}${gateNum}` })
  },

  // 生成行李转盘信息
  generateCarouselInfo(flightNo) {
    if (!flightNo) {
      this.setData({ carouselInfo: '--' })
      return
    }
    let hash = 0
    for (let i = 0; i < flightNo.length; i++) {
      hash = ((hash << 3) - hash) + flightNo.charCodeAt(i)
      hash |= 0
    }
    const carouselNum = Math.abs(hash) % 8 + 1
    this.setData({ carouselInfo: `${carouselNum}号转盘` })
  },

  // 生成航班动态时间线
  generateFlightTimeline(deptTimeStr, flightNo) {
    if (!deptTimeStr || deptTimeStr === '待定') {
      this.setData({ flightTimeline: [] })
      return
    }
    const deptTime = new Date(deptTimeStr.replace(/-/g, '/'))
    if (isNaN(deptTime.getTime())) {
      this.setData({ flightTimeline: [] })
      return
    }
    const now = new Date()
    // 基于航班号生成模拟延误
    let hash = 0
    if (flightNo) {
      for (let i = 0; i < flightNo.length; i++) {
        hash = ((hash << 5) - hash) + flightNo.charCodeAt(i)
        hash |= 0
      }
    }
    const delayMin = Math.abs(hash) % 10 === 0 ? Math.abs(hash >> 3) % 30 : 0 // 约10%概率延误
    const actualDept = new Date(deptTime.getTime() + delayMin * 60000)
    
    const timeline = [
      {
        status: '值机开放',
        time: this.formatTime(new Date(deptTime.getTime() - 24 * 3600000)),
        icon: '✅',
        done: now >= new Date(deptTime.getTime() - 24 * 3600000)
      },
      {
        status: '开始登机',
        time: this.formatTime(new Date(deptTime.getTime() - 30 * 60000)),
        icon: '🚪',
        done: now >= new Date(deptTime.getTime() - 30 * 60000)
      },
      {
        status: delayMin > 0 ? `延误${delayMin}分钟` : '准时起飞',
        time: this.formatTime(actualDept),
        icon: delayMin > 0 ? '⏰' : '✈️',
        done: now >= actualDept
      },
      {
        status: '飞行中',
        time: '巡航高度 10000m',
        icon: '🌤️',
        done: now >= new Date(actualDept.getTime() + 10 * 60000)
      },
      {
        status: '即将降落',
        time: '开始下降',
        icon: '🔽',
        done: now >= new Date(actualDept.getTime() + 60 * 60000)
      },
      {
        status: '已到达',
        time: this.formatTime(new Date(actualDept.getTime() + 120 * 60000)),
        icon: '🏁',
        done: now >= new Date(actualDept.getTime() + 120 * 60000)
      }
    ]
    this.setData({ flightTimeline: timeline })
  },

  formatTime(date) {
    const h = String(date.getHours()).padStart(2, '0')
    const m = String(date.getMinutes()).padStart(2, '0')
    return `${h}:${m}`
  },

  // 倒计时
  startCountdown(deptTimeStr) {
    if (!deptTimeStr || deptTimeStr === '待定') return
    const deptTime = new Date(deptTimeStr.replace(/-/g, '/'))
    if (isNaN(deptTime.getTime())) return
    this._countdownTimer = setInterval(() => {
      const now = new Date()
      const diff = deptTime.getTime() - now.getTime()
      if (diff <= 0) {
        this.setData({ countdown: '已过出发时间', countdownStatus: 'past' })
        clearInterval(this._countdownTimer)
        return
      }
      const days = Math.floor(diff / 86400000)
      const hours = Math.floor((diff % 86400000) / 3600000)
      const mins = Math.floor((diff % 3600000) / 60000)
      const secs = Math.floor((diff % 60000) / 1000)
      let text = ''
      if (days > 0) text = `${days}天 ${hours}时 ${mins}分`
      else if (hours > 0) text = `${hours}时 ${mins}分 ${secs}秒`
      else if (mins > 0) text = `${mins}分 ${secs}秒`
      else text = `${secs}秒`
      const status = diff < 3600000 ? 'urgent' : 'upcoming' // 小于1小时为紧急
      this.setData({ countdown: text, countdownStatus: status })
    }, 1000)
  },

  onUnload() {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer)
    }
  },

  generateQRContent(order) {
    return `【云端航空电子登机牌】
------------------
乘客：${order.passenger_name}
航班：${order.flight_info.flight_no}
座位：${order.seat_no}
订单号：${order._id}`
  },

  drawMyQRCode(content) {
    drawQrcode({
      width: 200,
      height: 200,
      canvasId: 'myQrcode',
      text: content,
      _this: this, 
      correctLevel: 1,
      callback: (e) => {
        console.log('二维码绘制成功', e)
        this.setData({ isQrLoading: false })
      }
    })
  },

  onSaveToAlbum() {
    wx.showLoading({ title: '保存中...' })
    wx.canvasToTempFilePath({
      canvasId: 'myQrcode',
      success: (res) => {
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => {
            wx.hideLoading()
            wx.showToast({ title: '已保存到相册', icon: 'success' })
          },
          fail: (err) => {
            wx.hideLoading()
            if (err.errMsg.includes('deny') || err.errMsg.includes('auth')) {
              wx.showModal({
                title: '提示',
                content: '需要您授权保存到相册',
                confirmText: '去授权',
                success: (modalRes) => {
                  if (modalRes.confirm) {
                    wx.openSetting()
                  }
                }
              })
            } else {
              wx.showToast({ title: '保存失败', icon: 'none' })
            }
          }
        })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '生成图片失败', icon: 'none' })
      }
    })
  },

  // 分享给好友
  onShareAppMessage() {
    const { order } = this.data
    return {
      title: `${order.passenger_name || '好友'}的登机牌 - ${order.flight_info.flight_no || ''}`,
      path: `/pages/boarding-pass/index?order=${encodeURIComponent(JSON.stringify(order))}`
    }
  },

  // 退票
  onRefundFromBoarding() {
    const { order } = this.data
    if (order.status !== 1) {
      wx.showToast({ title: '该订单已退票', icon: 'none' })
      return
    }
    wx.showModal({
      title: '退票确认',
      content: '确定要退掉这张票吗？座位将释放给他人。',
      success: (res) => {
        if (res.confirm) {
          this.executeRefund()
        }
      }
    })
  },

  executeRefund() {
    const { order } = this.data
    wx.showLoading({ title: '正在退票...' })
    const db = wx.cloud.database()
    db.collection('orders').where({
      _id: order._id,
      status: 1
    }).update({
      data: { status: 2 }
    }).then(res => {
      if (res.stats.updated === 0) {
        throw new Error('订单状态异常')
      }
      return db.collection('seats').doc(order.seat_id).update({
        data: { status: 0 }
      })
    }).then(() => {
      wx.hideLoading()
      wx.showToast({ title: '退票成功', icon: 'success' })
      // 更新本地状态
      this.setData({ 'order.status': 2, isRefunded: true })
    }).catch(err => {
      console.error('退票失败', err)
      wx.hideLoading()
      wx.showToast({ title: '退票失败', icon: 'none' })
    })
  },

  // 复制订单号
  onCopyOrderId() {
    wx.setClipboardData({
      data: this.data.order._id || '',
      success: () => {
        wx.showToast({ title: '订单号已复制', icon: 'success' })
      }
    })
  },

  // 返回上一页
  onGoBack() {
    wx.navigateBack({
      fail: () => {
        wx.switchTab({ url: '/pages/order-list/index' })
      }
    })
  },

  // 设置行程提醒
  onSetReminder() {
    const { order, reminderMinutes } = this.data
    if (!order.flight_info || !order.flight_info.dept_time) {
      wx.showToast({ title: '无法设置提醒', icon: 'none' })
      return
    }
    const reminders = wx.getStorageSync('flightReminders') || []
    // 检查是否已设置
    const exists = reminders.find(r => r.orderId === order._id)
    if (exists) {
      wx.showToast({ title: '已设置过提醒', icon: 'none' })
      return
    }
    reminders.push({
      orderId: order._id,
      flightNo: order.flight_info.flight_no,
      deptTime: order.flight_info.dept_time,
      origin: order.flight_info.origin,
      dest: order.flight_info.dest,
      reminderMinutes,
      createTime: new Date().toISOString()
    })
    wx.setStorageSync('flightReminders', reminders)
    this.setData({ reminderSet: true })
    wx.showToast({ title: `出发前${reminderMinutes}分钟将提醒`, icon: 'success' })
  },

  // 选择提醒时间
  onSelectReminderTime(e) {
    this.setData({ reminderMinutes: e.currentTarget.dataset.minutes })
  },

  // 电子发票
  onRequestInvoice() {
    const { order } = this.data
    if (!order || !order.flight_info) {
      wx.showToast({ title: '无法生成发票', icon: 'none' })
      return
    }
    const fi = order.flight_info
    const invoiceNo = 'INV' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 100).toString().padStart(2, '0')
    const invoiceInfo = {
      invoiceNo,
      title: '云端航空电子发票',
      flightNo: fi.flight_no,
      route: `${fi.origin} → ${fi.dest}`,
      date: fi.dept_time,
      passenger: order.passenger_name || '旅客',
      seatNo: order.seat_no,
      amount: `¥${order.price}`,
      taxRate: '6%',
      taxAmount: `¥${(order.price * 0.06).toFixed(2)}`,
      totalAmount: `¥${(order.price * 1.06).toFixed(2)}`,
      issueDate: new Date().toLocaleDateString('zh-CN'),
      status: '已开具'
    }
    this.setData({ showInvoiceModal: true, invoiceInfo })
  },

  // 复制发票信息
  onCopyInvoice() {
    const info = this.data.invoiceInfo
    if (!info) return
    const text = `${info.title}\n发票号：${info.invoiceNo}\n航班：${info.flightNo}\n航线：${info.route}\n日期：${info.date}\n乘客：${info.passenger}\n座位：${info.seatNo}\n金额：${info.amount}\n税率：${info.taxRate}\n税额：${info.taxAmount}\n价税合计：${info.totalAmount}\n开具日期：${info.issueDate}\n状态：${info.status}`
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showToast({ title: '发票信息已复制', icon: 'success' })
      }
    })
  },

  // 关闭发票弹窗
  onCloseInvoice() {
    this.setData({ showInvoiceModal: false })
  },

  // 显示行程分享卡片
  onShowShareCard() {
    const { order, myDate, myTime, myArrTime, flightDuration, gateInfo } = this.data
    const fi = order.flight_info || {}
    const text = `✈️ 云端航空 · 行程分享\n` +
      `━━━━━━━━━━━━━\n` +
      `🛫 ${fi.origin} → ${fi.dest}\n` +
      `📅 ${myDate}\n` +
      `🕐 ${myTime} - ${myArrTime}\n` +
      `✈️ 航班：${fi.flight_no}\n` +
      `💺 座位：${order.seat_no}\n` +
      `🚪 登机口：${gateInfo}\n` +
      `⏱ 飞行时长：${flightDuration || '直飞'}\n` +
      `━━━━━━━━━━━━━\n` +
      `乘客：${order.passenger_name || '贵宾'}\n` +
      `云端航空 · 让飞行更简单`
    this.setData({ showShareCard: true, shareCardText: text })
  },

  // 复制行程分享文本
  onCopyShareText() {
    wx.setClipboardData({
      data: this.data.shareCardText,
      success: () => {
        wx.showToast({ title: '行程已复制，可分享到朋友圈', icon: 'success' })
      }
    })
  },

  // 关闭分享卡片
  onCloseShareCard() {
    this.setData({ showShareCard: false })
  },

  // 添加到日历
  onAddToCalendar() {
    const { order, myDate, myTime, myArrTime } = this.data
    const fi = order.flight_info || {}
    if (!myDate || !myTime) {
      wx.showToast({ title: '缺少航班时间信息', icon: 'none' })
      return
    }
    // 构造日历事件描述
    const eventDesc = `航班：${fi.flight_no}\n航线：${fi.origin} → ${fi.dest}\n座位：${order.seat_no}\n登机口：${this.data.gateInfo}`
    // 微信小程序没有直接添加日历的API，使用复制文本方式
    const calText = `【航班提醒】\n${fi.flight_no} ${fi.origin}→${fi.dest}\n日期：${myDate}\n时间：${myTime}-${myArrTime}\n座位：${order.seat_no}\n登机口：${this.data.gateInfo}`
    wx.setClipboardData({
      data: calText,
      success: () => {
        wx.showModal({
          title: '添加到日历',
          content: '航班信息已复制到剪贴板，请打开手机日历，新建事件并粘贴内容。',
          showCancel: false,
          confirmText: '知道了'
        })
      }
    })
  },

  // 显示机场导航
  onShowAirportNav() {
    const { order, gateInfo } = this.data
    const fi = order.flight_info || {}
    const gate = gateInfo || '--'
    // 生成机场导航路径点
    const navPoints = [
      { name: '入口', icon: '🚪', desc: '机场出发大厅', distance: '0m', time: '' },
      { name: '安检', icon: '🔒', desc: '安全检查通道', distance: '200m', time: '约5分钟' },
      { name: '候机区', icon: '💺', desc: '候机休息区', distance: '300m', time: '约3分钟' },
      { name: '登机口', icon: '🚷', desc: `登机口 ${gate}`, distance: '500m', time: '约5分钟' },
      { name: '登机', icon: '✈️', desc: '登机入座', distance: '50m', time: '约2分钟' }
    ]
    this.setData({ showAirportNav: true, airportNavPoints: navPoints })
  },

  // 关闭机场导航
  onCloseAirportNav() {
    this.setData({ showAirportNav: false })
  }
})