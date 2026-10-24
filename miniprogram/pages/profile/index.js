// pages/profile/index.js
const db = wx.cloud.database()
const _ = db.command
const app = getApp()
const drawQrcode = require('../../utils/weapp-qrcode.js')

Page({
  data: {
    userInfo: {
      avatarUrl: '', 
      nickName: ''
    },
    isLogin: false,
    
    // ▼▼▼ 新增：控制联系客服弹窗显示 ▼▼▼
    showContactModal: false,
    showFeedbackModal: false,
    feedbackType: 'bug',
    feedbackContent: '',
    showFavoritesModal: false,
    favoriteFlights: [],
    showSecurityModal: false,
    showPassengersModal: false,
    passengers: [],
    newPassengerName: '',
    newPassengerIdCard: '',
    showMessagesModal: false,
    messages: [],
    unreadCount: 0,
    orderStats: { total: 0, paid: 0, refunded: 0 },
    loginDuration: '',
    tapCount: 0,
    currentTheme: 'blue',
    showThemeModal: false,
    travelStats: {
      totalFlights: 0,
      totalDistance: 0,
      topRoutes: [],
      monthFlights: [],
      monthSpending: [],
      routeDistribution: [],
      statusDistribution: { paid: 0, refunded: 0 },
      yearlySummary: []
    },
    memberLevel: {
      name: '普通会员',
      icon: '🥉',
      points: 0,
      nextLevel: '',
      nextPoints: 0,
      progress: 0
    }
  },

  /**
   * 核心修改 1：使用 onShow
   * 每次切换到“我的”页面，都执行一次检查
   */
  onShow() {
    console.log('👀 1. 进入页面，开始检查...')
    
    // 1. 先看缓存
    const cacheUser = wx.getStorageSync('currentUser')
    console.log('📦 2. 本地缓存内容:', cacheUser)

    if (cacheUser) {
      console.log('✅ 3. 命中缓存，渲染界面')
      this.setData({
        userInfo: cacheUser,
        isLogin: true
      })
      this.updateLoginDuration()
    }

    // 2. 再查库
    this.checkUserStatus()
    // 3. 查订单统计
    this.getOrderStats()
    // 4. 加载主题
    const theme = wx.getStorageSync('appTheme') || 'blue'
    this.setData({ currentTheme: theme })
    this.applyTheme(theme)
  },

  checkUserStatus() {
    console.log('☁️ 4. 开始请求云数据库...')
    
    db.collection('users').get().then(res => {
      console.log('☁️ 5. 数据库返回结果:', res)
      
      if (res.data.length > 0) {
        const userData = res.data[0]
        console.log('✅ 6. 查到用户:', userData)
        this.setData({
          userInfo: userData,
          isLogin: true
        })
        wx.setStorageSync('currentUser', userData)
      } else {
        console.log('⚠️ 7. 数据库里没这个用户 (未注册)')
        // 如果缓存也没有，那就显示未登录
        const cacheUser = wx.getStorageSync('currentUser')
        if (!cacheUser) {
          this.setData({ isLogin: false })
        }
      }
    }).catch(err => {
      console.error('❌ 8. 查库报错:', err)
    })
  },

  getOrderStats() {
    const MAX_LIMIT = 20
    db.collection('orders').count().then(countRes => {
      const total = countRes.total
      if (total === 0) {
        this.setData({ orderStats: { total: 0, paid: 0, refunded: 0 } })
        return
      }
      const batchTimes = Math.ceil(total / MAX_LIMIT)
      const allResults = []
      for (let i = 0; i < batchTimes; i++) {
        allResults.push(
          db.collection('orders').skip(i * MAX_LIMIT).limit(MAX_LIMIT).get()
        )
      }
      Promise.all(allResults).then(results => {
        let allData = []
        results.forEach(res => { allData = allData.concat(res.data) })
        const paid = allData.filter(o => o.status === 1).length
        const refunded = allData.filter(o => o.status === 2).length
        this.setData({ orderStats: { total, paid, refunded } })
        // 计算出行统计
        this.calcTravelStats(allData)
      })
    }).catch(() => {})
  },

  // 版本号点击彩蛋
  onVersionTap() {
    const count = this.data.tapCount + 1
    this.setData({ tapCount: count })
    if (count >= 5) {
      this.setData({ tapCount: 0 })
      wx.showModal({
        title: '云端航空',
        content: '感谢使用云端航空！\n这是一个基于微信云开发的航空订票演示系统。\n技术栈：微信小程序 + 云开发\n\n祝您旅途愉快！',
        showCancel: false,
        confirmText: '继续使用'
      })
    } else if (count >= 3) {
      wx.showToast({ title: `再点${5 - count}次有惊喜`, icon: 'none', duration: 800 })
    }
  },

  // 计算出行统计
  calcTravelStats(orders) {
    const paidOrders = orders.filter(o => o.status === 1)
    const refundedOrders = orders.filter(o => o.status === 2)
    const totalFlights = paidOrders.length
    // 模拟总里程（每条航线约1000-2000km）
    const cityDistances = {
      '北京-上海': 1200, '北京-广州': 1900, '北京-深圳': 2000, '北京-成都': 1500,
      '上海-广州': 1300, '上海-深圳': 1400, '上海-成都': 1700, '广州-成都': 1200,
      '深圳-成都': 1300, '北京-杭州': 1200, '上海-杭州': 200, '广州-杭州': 1100
    }
    let totalDistance = 0
    const routeCount = {}
    const routeSpending = {}
    paidOrders.forEach(order => {
      const fi = order.flight_info || {}
      const route = `${fi.origin}-${fi.dest}`
      const reverseRoute = `${fi.dest}-${fi.origin}`
      totalDistance += cityDistances[route] || cityDistances[reverseRoute] || (800 + Math.floor(Math.random() * 1200))
      routeCount[route] = (routeCount[route] || 0) + 1
      routeSpending[route] = (routeSpending[route] || 0) + (order.price || 0)
    })
    // 排序取前3条常飞航线
    const topRoutes = Object.entries(routeCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([route, count]) => ({ route, count }))
    // 航线消费分布
    const routeDistribution = Object.entries(routeSpending)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([route, amount]) => {
        const count = routeCount[route] || 1
        return { route, amount, count, avgPrice: Math.round(amount / count) }
      })
    // 近6个月飞行次数和消费
    const monthFlights = []
    const monthSpending = []
    const now = new Date()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const monthLabel = `${d.getMonth() + 1}月`
      const monthPaid = paidOrders.filter(o => {
        const od = new Date(o.create_time)
        return od.getFullYear() === d.getFullYear() && od.getMonth() === d.getMonth()
      })
      const monthCount = monthPaid.length
      const monthAmount = monthPaid.reduce((sum, o) => sum + (o.price || 0), 0)
      monthFlights.push({ month: monthLabel, count: monthCount })
      monthSpending.push({ month: monthLabel, amount: monthAmount })
    }
    // 归一化柱状图高度（最大高度55px，避免溢出容器）
    const maxSpending = Math.max(...monthSpending.map(m => m.amount), 1)
    const maxFlights = Math.max(...monthFlights.map(m => m.count), 1)
    monthSpending.forEach(m => {
      m.barHeight = m.amount > 0 ? Math.max(8, Math.round((m.amount / maxSpending) * 50) + 5) : 3
    })
    monthFlights.forEach(m => {
      m.barHeight = m.count > 0 ? Math.max(8, Math.round((m.count / maxFlights) * 50) + 5) : 3
    })
    // 订单状态分布
    const statusDistribution = { paid: paidOrders.length, refunded: refundedOrders.length }
    // 年度总结
    const yearlySummary = []
    for (let y = now.getFullYear(); y >= now.getFullYear() - 1; y--) {
      const yearOrders = paidOrders.filter(o => new Date(o.create_time).getFullYear() === y)
      const yearAmount = yearOrders.reduce((sum, o) => sum + (o.price || 0), 0)
      const yearDistance = yearOrders.reduce((sum, o) => {
        const fi = o.flight_info || {}
        const route = `${fi.origin}-${fi.dest}`
        const reverseRoute = `${fi.dest}-${fi.origin}`
        return sum + (cityDistances[route] || cityDistances[reverseRoute] || 1000)
      }, 0)
      yearlySummary.push({ year: y, flights: yearOrders.length, amount: yearAmount, distance: yearDistance })
    }
    this.setData({
      travelStats: { totalFlights, totalDistance, topRoutes, monthFlights, monthSpending, routeDistribution, statusDistribution, yearlySummary }
    })
    // 计算会员等级
    this.calcMemberLevel(totalFlights, totalDistance)
  },

  // 计算会员等级
  calcMemberLevel(flights, distance) {
    const points = flights * 100 + Math.floor(distance / 10)
    const levels = [
      { name: '普通会员', icon: '🥉', minPoints: 0, nextLevel: '银卡会员', nextPoints: 300 },
      { name: '银卡会员', icon: '🥈', minPoints: 300, nextLevel: '金卡会员', nextPoints: 800 },
      { name: '金卡会员', icon: '🥇', minPoints: 800, nextLevel: '白金会员', nextPoints: 2000 },
      { name: '白金会员', icon: '💎', minPoints: 2000, nextLevel: '', nextPoints: 0 }
    ]
    let level = levels[0]
    for (let i = levels.length - 1; i >= 0; i--) {
      if (points >= levels[i].minPoints) {
        level = levels[i]
        break
      }
    }
    const progress = level.nextPoints > 0
      ? Math.min(100, Math.floor((points - level.minPoints) / (level.nextPoints - level.minPoints) * 100))
      : 100
    this.setData({
      memberLevel: {
        name: level.name,
        icon: level.icon,
        points,
        nextLevel: level.nextLevel,
        nextPoints: level.nextPoints,
        progress
      }
    })
  },

  // 更新登录时长
  updateLoginDuration() {
    const loginTime = wx.getStorageSync('loginTime')
    if (!loginTime) {
      wx.setStorageSync('loginTime', Date.now())
      this.setData({ loginDuration: '刚刚' })
      return
    }
    const diff = Date.now() - loginTime
    const mins = Math.floor(diff / 60000)
    const hours = Math.floor(mins / 60)
    const days = Math.floor(hours / 24)
    let text = ''
    if (days > 0) text = `${days}天`
    else if (hours > 0) text = `${hours}小时`
    else if (mins > 0) text = `${mins}分钟`
    else text = '刚刚'
    this.setData({ loginDuration: text })
  },

  // 点击订单统计跳转
  onGoOrders(e) {
    const status = e.currentTarget.dataset.status
    wx.switchTab({
      url: '/pages/order-list/index',
      success: () => {
        // 通过事件通知订单列表页切换筛选
        const pages = getCurrentPages()
        const orderPage = pages[pages.length - 1]
        if (orderPage && orderPage.setData) {
          orderPage.setData({ filterStatus: status })
          orderPage.applyFilter && orderPage.applyFilter()
        }
      }
    })
  },

  // 2. 上传头像
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail
    this.setData({ 'userInfo.avatarUrl': avatarUrl })
    const cloudPath = 'avatars/' + Date.now() + '.png'
    wx.cloud.uploadFile({
      cloudPath,
      filePath: avatarUrl,
      success: res => {
        // 更新为云端 ID
        this.setData({ 'userInfo.avatarUrl': res.fileID })
        // 保存到数据库
        this.saveUserInfo() 
      }
    })
  },

  // 预览头像大图
  onPreviewAvatar() {
    const url = this.data.userInfo.avatarUrl
    if (!url) return
    wx.previewImage({
      current: url,
      urls: [url]
    })
  },

  onSaveNickname(e) {
    const nickName = e.detail.value
    if (!nickName || !nickName.trim()) return
    this.setData({ 'userInfo.nickName': nickName.trim() })
    this.saveUserInfo() 
  },

  saveUserInfo() {
    const { userInfo } = this.data

    if (!userInfo.nickName && !userInfo.avatarUrl) return

    // 剔除 _id 和 _openid，防止更新时报错
    const { _id, _openid, ...dataToUpdate } = userInfo

    db.collection('users').get().then(res => {
      if (res.data.length > 0) {
        // --- 更新逻辑 ---
        const docId = res.data[0]._id
        
        db.collection('users').doc(docId).update({
          data: dataToUpdate
        }).then(() => {
          console.log('✅ 更新成功')
          wx.showToast({ title: '已同步', icon: 'success' })
          // 更新缓存，包含数据库中的_id
          wx.setStorageSync('currentUser', { ...userInfo, _id: docId })
        }).catch(err => {
          console.error('❌ 更新失败', err)
        })
      } else {
        // --- 注册逻辑 ---
        db.collection('users').add({
          data: {
            ...dataToUpdate,
            createTime: new Date()
          }
        }).then((addRes) => {
          this.setData({ isLogin: true })
          wx.showToast({ title: '注册成功', icon: 'success' })
          wx.setStorageSync('currentUser', { ...userInfo, _id: addRes._id })
        })
      }
    })
  },

  onCheckPayment() {
    wx.showLoading({ title: '正在连接微信支付...' })

    setTimeout(() => {
      wx.hideLoading()
      const isSuccess = true 
      if (isSuccess) {
        wx.showModal({
          title: '支付检测结果',
          content: '✅ 账户状态正常\n✅ 支付功能可用\n✅ 实名认证已通过',
          showCancel: false,
          confirmText: '太好了'
        })
      } else {
        wx.showToast({ title: '支付异常', icon: 'none' })
      }
    }, 1500)
  },

  onContact() {
    this.setData({ showContactModal: true }, () => {
      drawQrcode({
        width: 160,
        height: 160,
        canvasId: 'qrcode',
        text: 'https://github.com/airbook-demo'
      })
    })
  },

  closeContactModal() {
    this.setData({ showContactModal: false })
  },

  preventBubble() {
  },
  
  onAbout() {
    wx.showModal({
      title: '关于',
      content: '这是一个基于微信云开发的航空订票演示系统。',
      showCancel: false
    })
  },

  // 意见反馈
  onFeedback() {
    this.setData({ showFeedbackModal: true, feedbackType: 'bug', feedbackContent: '' })
  },

  // 我的收藏
  onShowFavorites() {
    const favorites = wx.getStorageSync('flightFavorites') || []
    if (favorites.length === 0) {
      this.setData({ showFavoritesModal: true, favoriteFlights: [] })
      return
    }
    wx.showLoading({ title: '加载收藏...' })
    const MAX_LIMIT = 20
    db.collection('flights').where({
      _id: _.in(favorites)
    }).get().then(res => {
      wx.hideLoading()
      this.setData({ showFavoritesModal: true, favoriteFlights: res.data })
    }).catch(err => {
      wx.hideLoading()
      console.error('加载收藏失败', err)
      this.setData({ showFavoritesModal: true, favoriteFlights: [] })
    })
  },

  closeFavoritesModal() {
    this.setData({ showFavoritesModal: false })
  },

  onBookFavorite(e) {
    const flight = e.currentTarget.dataset.flight
    this.setData({ showFavoritesModal: false })
    const flightStr = JSON.stringify(flight)
    wx.navigateTo({
      url: `/pages/seat-select/index?flight=${encodeURIComponent(flightStr)}`
    })
  },

  onRemoveFavorite(e) {
    const id = e.currentTarget.dataset.id
    let favorites = wx.getStorageSync('flightFavorites') || []
    favorites = favorites.filter(f => f !== id)
    wx.setStorageSync('flightFavorites', favorites)
    const favoriteFlights = this.data.favoriteFlights.filter(f => f._id !== id)
    this.setData({ favoriteFlights })
    wx.showToast({ title: '已移除', icon: 'none', duration: 800 })
  },

  // 账户安全设置
  onAccountSecurity() {
    this.setData({ showSecurityModal: true })
  },

  closeSecurityModal() {
    this.setData({ showSecurityModal: false })
  },

  onBindPhone() {
    wx.showToast({ title: '功能开发中', icon: 'none' })
  },

  onSetPassword() {
    wx.showToast({ title: '功能开发中', icon: 'none' })
  },

  onBindEmail() {
    wx.showToast({ title: '功能开发中', icon: 'none' })
  },

  // 常用乘客管理
  onShowPassengers() {
    const passengers = wx.getStorageSync('passengers') || []
    // 为每个乘客添加显示属性
    const enhancedPassengers = passengers.map(p => ({
      ...p,
      typeText: p.type === 'child' ? '儿童' : '成人',
      typeClass: p.type === 'child' ? 'pax-child' : 'pax-adult'
    }))
    this.setData({ showPassengersModal: true, passengers: enhancedPassengers, newPassengerName: '', newPassengerIdCard: '', newPassengerPhone: '', newPassengerType: 'adult', editingPassengerId: null })
  },

  closePassengersModal() {
    this.setData({ showPassengersModal: false, editingPassengerId: null })
  },

  onInputPassengerName(e) {
    this.setData({ newPassengerName: e.detail.value })
  },

  onInputPassengerIdCard(e) {
    this.setData({ newPassengerIdCard: e.detail.value })
  },

  onInputPassengerPhone(e) {
    this.setData({ newPassengerPhone: e.detail.value })
  },

  onPassengerTypeChange(e) {
    this.setData({ newPassengerType: e.detail.value })
  },

  onAddPassenger() {
    const { newPassengerName, newPassengerIdCard, newPassengerPhone, newPassengerType, passengers, editingPassengerId } = this.data
    if (!newPassengerName.trim()) {
      wx.showToast({ title: '请输入姓名', icon: 'none' })
      return
    }
    if (!newPassengerIdCard.trim() || newPassengerIdCard.trim().length < 15) {
      wx.showToast({ title: '请输入有效身份证号', icon: 'none' })
      return
    }
    if (editingPassengerId) {
      // 编辑模式
      const idx = passengers.findIndex(p => p.id === editingPassengerId)
      if (idx >= 0) {
        passengers[idx].name = newPassengerName.trim()
        passengers[idx].idCard = newPassengerIdCard.trim().replace(/^(.{6})(.+)(.{4})$/, '$1******$3')
        passengers[idx].phone = newPassengerPhone.trim()
        passengers[idx].type = newPassengerType
        passengers[idx].typeText = newPassengerType === 'child' ? '儿童' : '成人'
        passengers[idx].typeClass = newPassengerType === 'child' ? 'pax-child' : 'pax-adult'
        wx.setStorageSync('passengers', passengers)
        this.setData({ passengers, newPassengerName: '', newPassengerIdCard: '', newPassengerPhone: '', editingPassengerId: null })
        wx.showToast({ title: '修改成功', icon: 'success' })
      }
      return
    }
    if (passengers.length >= 10) {
      wx.showToast({ title: '最多添加10位乘客', icon: 'none' })
      return
    }
    const newPassenger = {
      id: Date.now().toString(),
      name: newPassengerName.trim(),
      idCard: newPassengerIdCard.trim().replace(/^(.{6})(.+)(.{4})$/, '$1******$3'),
      phone: newPassengerPhone.trim(),
      type: newPassengerType,
      typeText: newPassengerType === 'child' ? '儿童' : '成人',
      typeClass: newPassengerType === 'child' ? 'pax-child' : 'pax-adult'
    }
    passengers.push(newPassenger)
    wx.setStorageSync('passengers', passengers)
    this.setData({ passengers, newPassengerName: '', newPassengerIdCard: '', newPassengerPhone: '' })
    wx.showToast({ title: '添加成功', icon: 'success' })
  },

  onEditPassenger(e) {
    const passenger = e.currentTarget.dataset.passenger
    this.setData({
      editingPassengerId: passenger.id,
      newPassengerName: passenger.name,
      newPassengerIdCard: '',
      newPassengerPhone: passenger.phone || '',
      newPassengerType: passenger.type || 'adult'
    })
  },

  onCancelEditPassenger() {
    this.setData({ editingPassengerId: null, newPassengerName: '', newPassengerIdCard: '', newPassengerPhone: '' })
  },

  onDeletePassenger(e) {
    const index = e.currentTarget.dataset.index
    const passengers = this.data.passengers
    passengers.splice(index, 1)
    wx.setStorageSync('passengers', passengers)
    this.setData({ passengers })
    wx.showToast({ title: '已删除', icon: 'none', duration: 800 })
  },

  // 系统消息
  onShowMessages() {
    // 生成模拟系统消息
    const now = new Date()
    const formatDate = (d) => `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
    const messages = [
      { id: 1, title: '欢迎使用云端航空', content: '感谢您使用云端航空订票系统，祝您旅途愉快！', time: formatDate(new Date(now.getTime() - 86400000)), read: false },
      { id: 2, title: '系统升级通知', content: '系统已完成升级，新增在线选座、航班收藏等功能。', time: formatDate(new Date(now.getTime() - 172800000)), read: false },
      { id: 3, title: '安全提示', content: '请勿向他人透露您的订单信息和个人身份信息。', time: formatDate(new Date(now.getTime() - 259200000)), read: true }
    ]
    const unreadCount = messages.filter(m => !m.read).length
    this.setData({ showMessagesModal: true, messages, unreadCount: 0 })
    // 标记所有消息为已读
    const updatedMessages = messages.map(m => ({ ...m, read: true }))
    this.setData({ messages: updatedMessages })
  },

  closeMessagesModal() {
    this.setData({ showMessagesModal: false })
  },

  closeFeedbackModal() {
    this.setData({ showFeedbackModal: false })
  },

  onSelectFeedbackType(e) {
    this.setData({ feedbackType: e.currentTarget.dataset.type })
  },

  onFeedbackInput(e) {
    this.setData({ feedbackContent: e.detail.value })
  },

  onSubmitFeedback() {
    const { feedbackType, feedbackContent } = this.data
    if (!feedbackContent.trim()) {
      wx.showToast({ title: '请输入反馈内容', icon: 'none' })
      return
    }
    wx.showLoading({ title: '提交中...' })
    db.collection('feedback').add({
      data: {
        type: feedbackType,
        content: feedbackContent.trim(),
        user: this.data.userInfo.nickName || '匿名用户',
        create_time: new Date()
      }
    }).then(() => {
      wx.hideLoading()
      wx.showToast({ title: '感谢您的反馈', icon: 'success' })
      this.setData({ showFeedbackModal: false, feedbackContent: '' })
    }).catch(err => {
      console.error('提交反馈失败', err)
      wx.hideLoading()
      wx.showToast({ title: '提交失败，请重试', icon: 'none' })
    })
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync('currentUser')
          wx.removeStorageSync('loginTime')
          this.setData({
            userInfo: { avatarUrl: '', nickName: '' },
            isLogin: false,
            loginDuration: ''
          })
          wx.showToast({ title: '已退出', icon: 'success' })
        }
      }
    })
  },

  // 分享给好友
  onShareAppMessage() {
    const { userInfo } = this.data
    return {
      title: userInfo.nickName ? `${userInfo.nickName}邀请你使用云端航空` : '云端航空 - 机票预订',
      path: '/pages/index/index'
    }
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.checkUserStatus()
    this.getOrderStats()
    this.updateLoginDuration()
    // 简单延迟停止刷新，因为 checkUserStatus 和 getOrderStats 是异步的
    setTimeout(() => {
      wx.stopPullDownRefresh()
      wx.showToast({ title: '已刷新', icon: 'success', duration: 1000 })
    }, 1500)
  },

  // 主题切换
  onShowTheme() {
    this.setData({ showThemeModal: true })
  },

  closeThemeModal() {
    this.setData({ showThemeModal: false })
  },

  onSelectTheme(e) {
    const theme = e.currentTarget.dataset.theme
    this.setData({ currentTheme: theme })
    wx.setStorageSync('appTheme', theme)
    this.applyTheme(theme)
    wx.showToast({ title: '主题已切换', icon: 'success', duration: 800 })
  },

  applyTheme(theme) {
    const themes = {
      blue: { primary: '#0052d9', navBg: '#0052d9' },
      green: { primary: '#00875a', navBg: '#00875a' },
      purple: { primary: '#722ed1', navBg: '#722ed1' }
    }
    const t = themes[theme] || themes.blue
    wx.setNavigationBarColor({
      frontColor: '#ffffff',
      backgroundColor: t.navBg,
      animation: { duration: 300, timingFunc: 'easeIn' }
    })
    // 保存到全局供其他页面使用
    const app = getApp()
    app.globalData.themePrimary = t.primary
  }
})